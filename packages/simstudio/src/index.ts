#!/usr/bin/env node

import { Command } from 'commander'
import inquirer from 'inquirer'
import { execSync } from 'child_process'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { existsSync, writeFileSync } from 'fs'
import chalk from 'chalk'
import updateNotifier from 'update-notifier'
import open from 'open'
import pkg from '../package.json' with { type: 'json' }

// Check for updates
updateNotifier({ pkg }).notify()

interface StartAnswers {
  useDocker: boolean
  port?: string
}

const program = new Command()
const __dirname = fileURLToPath(new URL('.', import.meta.url))

// Helper function to run the start command
async function startSimStudio() {
  console.log(chalk.magenta(`
  ███████╗██╗███╗   ███╗    ███████╗████████╗██╗   ██╗██████╗ ██╗ ██████╗ 
  ██╔════╝██║████╗ ████║    ██╔════╝╚══██╔══╝██║   ██║██╔══██╗██║██╔═══██╗
  ███████╗██║██╔████╔██║    ███████╗   ██║   ██║   ██║██║  ██║██║██║   ██║
  ╚════██║██║██║╚██╔╝██║    ╚════██║   ██║   ██║   ██║██║  ██║██║██║   ██║
  ███████║██║██║ ╚═╝ ██║    ███████║   ██║   ╚██████╔╝██████╔╝██║╚██████╔╝
  ╚══════╝╚═╝╚═╝     ╚═╝    ╚══════╝   ╚═╝    ╚═════╝ ╚═════╝ ╚═╝ ╚═════╝ 
                                                                         
`))
  console.log(chalk.gray('Lightweight, user-friendly platform for building AI agent workflows\n'))
  
  const answers = await inquirer.prompt<StartAnswers>([
    {
      type: 'confirm',
      name: 'useDocker',
      message: 'Do you want to use Docker? (Recommended)',
      default: true
    },
    {
      type: 'input',
      name: 'port',
      message: 'What port would you like to use?',
      default: '3000',
      validate: (input) => {
        const port = parseInt(input)
        if (isNaN(port)) {
          return 'Please enter a valid number'
        }
        if (port < 1 || port > 65535) {
          return 'Port must be between 1 and 65535'
        }
        return true
      }
    }
  ])

  if (answers.useDocker) {
    // Check if Docker is installed
    try {
      execSync('docker --version', { stdio: 'ignore' })
    } catch (error) {
      console.error(chalk.red('❌ Docker is not installed. Please install Docker first:'))
      console.log(chalk.yellow('  https://docs.docker.com/get-docker/'))
      process.exit(1)
    }

    // Create .env file if it doesn't exist
    const envPath = join(process.cwd(), '.env')
    if (!existsSync(envPath)) {
      console.log(chalk.yellow('Creating .env file...'))
      const envContent = `
DATABASE_URL=postgresql://postgres:postgres@db:5432/simstudio
POSTGRES_URL=postgresql://postgres:postgres@db:5432/simstudio
BETTER_AUTH_URL=http://localhost:${answers.port}
NEXT_PUBLIC_APP_URL=http://localhost:${answers.port}
BETTER_AUTH_SECRET=your_auth_secret_here
ENCRYPTION_KEY=your_encryption_key_here
FREESTYLE_API_KEY=placeholder
GOOGLE_CLIENT_ID=placeholder
GOOGLE_CLIENT_SECRET=placeholder
GITHUB_CLIENT_ID=placeholder
GITHUB_CLIENT_SECRET=placeholder
RESEND_API_KEY=placeholder
`.trim()
      writeFileSync(envPath, envContent)
      console.log(chalk.green('✓ .env file created'))
    }

    // Create docker-compose.yml if it doesn't exist
    const composePath = join(process.cwd(), 'docker-compose.yml')
    if (!existsSync(composePath)) {
      console.log(chalk.yellow('Creating docker-compose.yml...'))
      const composeContent = `
services:
  simstudio:
    image: ghcr.io/simstudioai/sim:latest
    ports:
      - "${answers.port}:3000"
    volumes:
      - ./.env:/app/.env
    environment:
      - NODE_ENV=development
      - DATABASE_URL=postgresql://postgres:postgres@db:5432/simstudio
      - POSTGRES_URL=postgresql://postgres:postgres@db:5432/simstudio
      - BETTER_AUTH_URL=http://localhost:${answers.port}
      - NEXT_PUBLIC_APP_URL=http://localhost:${answers.port}
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:16
    restart: always
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
      - POSTGRES_DB=simstudio
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:`
      writeFileSync(composePath, composeContent)
      console.log(chalk.green('✓ docker-compose.yml created'))
    }

    // Start Docker Compose
    try {
      // Check if the docker image exists locally, otherwise pull it
      try {
        console.log(chalk.blue('🔍 Checking for Docker image...'))
        execSync('docker image inspect ghcr.io/simstudioai/sim:latest', { stdio: 'ignore' })
        console.log(chalk.green('✓ Found existing Docker image'))
      } catch (error) {
        console.log(chalk.blue('🚚 Pulling latest Docker image...'))
        execSync('docker pull ghcr.io/simstudioai/sim:latest', { stdio: 'inherit' })
        console.log(chalk.green('✓ Successfully pulled Docker image'))
      }

      console.log(chalk.blue('🚀 Starting Sim Studio with Docker Compose...'))
      execSync('docker compose up -d', { stdio: 'inherit' })

      // Open browser after a short delay
      setTimeout(() => {
        console.log(chalk.green('✓ Opening Sim Studio in your browser...'))
        open(`http://localhost:${answers.port}`)
      }, 5000)
    } catch (error) {
      console.error(chalk.red('❌ Error starting Sim Studio:'), error)
      console.log(chalk.yellow('\nTroubleshooting tips:'))
      console.log('  1. Make sure Docker is running')
      console.log('  2. Check if port ' + answers.port + ' is available')
      console.log('  3. Try running with a different port')
      console.log('  4. Visit https://github.com/simstudioai/sim for more help')
      process.exit(1)
    }
  } else {
    // Local installation
    try {
      console.log(chalk.blue('📦 Installing dependencies...'))
      execSync('npm install', { stdio: 'inherit' })
      
      console.log(chalk.blue('🚀 Starting Sim Studio...'))
      execSync('npm run dev', { stdio: 'inherit' })

      // Open browser after a short delay
      setTimeout(() => {
        console.log(chalk.green('✓ Opening Sim Studio in your browser...'))
        open('http://localhost:3000')
      }, 5000)
    } catch (error) {
      console.error(chalk.red('❌ Error starting Sim Studio:'), error)
      console.log(chalk.yellow('\nTroubleshooting tips:'))
      console.log('  1. Make sure Node.js 20+ is installed')
      console.log('  2. Check if port 3000 is available')
      console.log('  3. Try running with Docker instead')
      console.log('  4. Visit https://github.com/simstudioai/sim for more help')
      process.exit(1)
    }
  }
}

program
  .name('simstudio')
  .description('CLI tool for Sim Studio - easily start, build and test agent workflows')
  .version(pkg.version)
  .action(startSimStudio) // Run start when no command is specified

// Add explicit start command for backward compatibility
program
  .command('start')
  .description('Start Sim Studio')
  .action(startSimStudio)

program.parse() 