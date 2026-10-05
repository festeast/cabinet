import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' — сайт работает и на festeast.github.io, и в репозитории-проекте
export default defineConfig({ plugins: [react()], base: './' })
