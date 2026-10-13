import type { Api } from '../../preload/index.ts'

declare global {
  interface Window {
    kss: Api
  }
}

export const api = window.kss
