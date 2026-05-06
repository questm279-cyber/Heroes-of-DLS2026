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

// Random delay for anti-ban - FIXED BRACKET
const randomDelay = (min = 3000, max = 5000) => new Promise(resolve => 
    setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min)

// Terminal input for pairing code - only used if no env variable
const question = (text) => new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(text, (answer) => {
        rl.close()
        resolve(answer)
    })
})

async function startBot() {
    console.log("🚀 Starting WhatsApp Anti-Link Bot v2.2 - Pella Deployment")

    const { state, saveCreds } = await useMultiFileAuthState("./auth_info")

    const sock = makeWASocket({
        logger: pino({ level: "silent" }),
        printQRInTerminal: false,
        auth: state,
        browser: ["DLS-Bot", "Chrome", "120.0.0"],
        version: [2, 2413, 1],
        connectTimeoutMs: 30000,
    })

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update

        if (!state.creds.registered) {
            console.log("\n=== PAIRING CODE MODE ===")
            const phoneNumber = process.env.PHONE_NUMBER || await question("📱 Enter your WhatsApp number with country code [e.g. 27712345678]: ")
            const cleanNumber = phoneNumber.replace(/[^0-9]/g, '')
            
            if (!cleanNumber) {
                console.log("❌ No phone number found. Set PHONE_NUMBER in Pella Environment Variables")
                process.exit(1)
            }
            
            const code = await sock.requestPairingCode(cleanNumber)
            console.log(`\n✅ YOUR PAIRING CODE: ${code}`)
            console.log("📲 Open WhatsApp > Settings > Linked Devices > Link with phone number")
            console.log("⏰ Code expires in 30 seconds\n")
        }

        if (connection === "close") {
            const reason = new Boom(lastDisconnect?.error)?.output?.status
