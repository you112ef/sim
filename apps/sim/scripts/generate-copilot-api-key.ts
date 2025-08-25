import { config } from 'dotenv'
import { createCipheriv, createHash, createHmac, randomBytes } from 'crypto'
import { generateApiKey } from '@/lib/utils'

config()

function deriveKey(keyString: string): Buffer {
  return createHash('sha256').update(keyString, 'utf8').digest()
}

function encryptRandomIv(plaintext: string, keyString: string): string {
  const key = deriveKey(keyString)
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  let encrypted = cipher.update(plaintext, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag().toString('hex')
  return `${iv.toString('hex')}:${encrypted}:${authTag}`
}

function computeLookup(plaintext: string, keyString: string): string {
  return createHmac('sha256', Buffer.from(keyString, 'utf8')).update(plaintext, 'utf8').digest('hex')
}

async function main() {
  const dbKey = process.env.AGENT_API_DB_ENCRYPTION_KEY
  if (!dbKey) {
    console.error('AGENT_API_DB_ENCRYPTION_KEY is not set')
    process.exit(1)
  }

  // Match app behavior: strip generic sim_ and prefix with sk-sim-copilot-
  const rawKey = generateApiKey().replace(/^sim_/, '')
  const plaintextKey = `sk-sim-copilot-${rawKey}`

  const apiKeyEncrypted = encryptRandomIv(plaintextKey, dbKey)
  const apiKeyLookup = computeLookup(plaintextKey, dbKey)

  const out = { apiKey: plaintextKey, apiKeyEncrypted, apiKeyLookup }
  process.stdout.write(JSON.stringify(out) + '\n')
}

main().catch((err) => {
  console.error('Failed to generate copilot API key', err)
  process.exit(1)
}) 