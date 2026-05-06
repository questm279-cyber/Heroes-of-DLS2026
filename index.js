const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require("@whiskeysockets/baileys")
const { Boom } = require("@hapi/boom")
const pino = require("pino")
const fs = require('fs')
const readline = require('readline')

// ====== BOT SETTINGS ======
let settings = {
    antilink: true,
    antiword: true,
    warnKick: 3,
    antiBanDelay: true,
    badwords: [
        "fuck", "shit", "pussy", "nude", "poes", "naai",
        "dls account for sale", "account for sale", "inbox for price", "am selling account", "buying account", "dm for price"
    ],
}

// ====== WARNINGS DATABASE ======
let warnings = {}
const warningsFile = './warnings.json'
const settingsFile = './settings.json'

if (fs.existsSync(settingsFile)) settings = JSON.parse(fs.readFileSync(settingsFile))
if (fs.existsSync(warningsFile)) warnings = JSON.parse(fs.readFileSync(warningsFile))

const saveSettings = () => fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2))
const saveWarnings = () => fs.writeFileSync(warningsFile, JSON.stringify(warnings, null, 2))

// Clear warnings after 24h
setInterval(() => {
    const now = Date.now()
    const oneDay = 24 * 60 * 60 * 1000
    for (const key in warnings) {
        if (now - warnings[key].lastWarn > oneDay) delete warnings[key]
    }
    saveWarnings()
}, 60 * 60 * 1000)

// Random delay for anti-ban
const randomDelay = (min = 3000, max = 5000) => new Promise(resolve => 
    setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min)
)

// Terminal input for pairing code
const question = (text) => new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(text, (answer) => {
        rl.close()
        resolve(answer)
    })
})

async function startBot() {
    console.log("🚀 Starting WhatsApp Anti-Link Bot v2.1 - Pella Deployment")

    const { state, saveCreds } = await useMultiFileAuthState("./auth_info")

    const sock = makeWASocket({
        logger: pino({ level: "silent" }),
        printQRInTerminal: false, // Must be false for Pella
        auth: state,
        browser: ["DLS-Bot", "Chrome", "120.0.0"],
        version: [2, 2413, 1],
        connectTimeoutMs: 30000,
    })

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update

        if (!state.creds.registered) {
            console.log("\n=== PAIRING CODE MODE ===")
            const phoneNumber = await question("📱 Enter your WhatsApp number with country code [e.g. 27712345678]: ")
            const cleanNumber = phoneNumber.replace(/[^0-9]/g, '')
            const code = await sock.requestPairingCode(cleanNumber)
            console.log(`\n✅ YOUR PAIRING CODE: ${code}`)
            console.log("📲 Open WhatsApp > Settings > Linked Devices > Link with phone number")
            console.log("⏰ Code expires in 30 seconds\n")
        }

        if (connection === "close") {
            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode
            if (reason!== DisconnectReason.loggedOut) {
                console.log("🔄 Connection closed. Reconnecting in 5s...")
                setTimeout(startBot, 5000)
            } else {
                console.log("❌ Logged out. Delete./auth_info folder to get new pairing code.")
            }
        } else if (connection === "open") {
            console.log("✅ Bot connected! Anti-link + Warnings + Anti-Ban active.")
        }
    })

    sock.ev.on("creds.update", saveCreds)

    sock.ev.on("messages.upsert", async (m) => {
        try {
            const msg = m.messages[0]
            if (!msg.message || msg.key.fromMe) return

            const from = msg.key.remoteJid
            if (!from.endsWith("@g.us")) return // Only groups

            const sender = msg.key.participant || msg.key.remoteJid
            const text = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || ""
            const lowerText = text.toLowerCase()

            const groupMeta = await sock.groupMetadata(from)
            const groupAdmins = groupMeta.participants.filter(p => p.admin).map(p => p.id)
            const isAdmin = groupAdmins.includes(sender)
            const isBotAdmin = groupAdmins.includes(sock.user.id)

            // ====== ADMIN COMMANDS ======
            if (isAdmin && text.startsWith('!')) {
                const args = text.slice(1).trim().split(' ')
                const cmd = args[0].toLowerCase()

                if (cmd === 'antilink') {
                    settings.antilink = args[1] === 'on'
                    saveSettings()
                    return await sock.sendMessage(from, { text: `✅ Anti-link: ${settings.antilink? 'ON' : 'OFF'}` })
                }
                if (cmd === 'antiword') {
                    settings.antiword = args[1] === 'on'
                    saveSettings()
                    return await sock.sendMessage(from, { text: `✅ Anti-word: ${settings.antiword? 'ON' : 'OFF'}` })
                }
                if (cmd === 'warnlimit') {
                    const limit = parseInt(args[1])
                    if (limit > 0 && limit <= 5) {
                        settings.warnKick = limit
                        saveSettings()
                        return await sock.sendMessage(from, { text: `✅ Users kicked after ${limit} warnings` })
                    }
                }
                if (cmd === 'addword') {
                    const word = args.slice(1).join(' ').toLowerCase()
                    if (word &&!settings.badwords.includes(word)) {
                        settings.badwords.push(word)
                        saveSettings()
                        return await sock.sendMessage(from, { text: `✅ Added: "${word}"` })
                    }
                }
                if (cmd === 'help') {
                    const helpText = `*DLS BOT COMMANDS*

!antilink on/off - Toggle link deletion
!antiword on/off - Toggle word filter 
!warnlimit <1-5> - Set warnings before kick
!addword <word> - Add banned word
!removeword <word> - Remove banned word
!listwords - Show banned words
!warnings @user - Check warnings
!delwarn @user - Reset warnings`
                    return await sock.sendMessage(from, { text: helpText })
                }
            }

            if (!isBotAdmin || isAdmin) return

            // ====== ANTI-LINK ======
            const linkRegex = /https?:\/\/|www\.|wa\.me\/|t\.me\/|chat\.whatsapp\.com|discord\.gg/i
            if (settings.antilink && linkRegex.test(lowerText)) {
                await sock.sendMessage(from, { delete: msg.key })
                await sock.sendMessage(from, { text: `❌ @${sender.split('@')[0]} Links not allowed!`, mentions: [sender] })
                return
            }

            // ====== ANTI-WORD WITH WARNINGS ======
            if (settings.antiword) {
                const foundWord = settings.badwords.find(word => lowerText.includes(word))
                if (foundWord) {
                    const key = `${from}@${sender}`
                    if (!warnings[key]) warnings[key] = { count: 0, lastWarn: 0 }
                    warnings[key].count++
                    warnings[key].lastWarn = Date.now()
                    saveWarnings()

                    const warnCount = warnings[key].count
                    await sock.sendMessage(from, { delete: msg.key })

                    if (warnCount >= settings.warnKick) {
                        await sock.sendMessage(from, { text: `⛔ @${sender.split('@')[0]} reached ${settings.warnKick} warnings. Kicking...`, mentions: [sender] })
                        if (settings.antiBanDelay) await randomDelay()
                        await sock.groupParticipantsUpdate(from, [sender], "remove")
                        delete warnings[key]
                        saveWarnings()
                    } else {
                        await sock.sendMessage(from, { text: `⚠️ @${sender.split('@')[0]} Warning ${warnCount}/${settings.warnKick} - No bad words!`, mentions: [sender] })
                    }
                }
            }
        } catch (e) {
            console.log("Error:", e.message)
        }
    })
}

process.on('uncaughtException', (err) => console.log('Error:', err.message))
startBot()
