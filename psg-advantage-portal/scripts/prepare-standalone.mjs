import { prepareStandaloneAssets } from './standalone-runtime.mjs'

prepareStandaloneAssets(process.cwd())

console.log('[prepare-standalone] copied .next/static and public into .next/standalone')
