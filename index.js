import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const appsPath = path.join(__dirname, 'apps')
const apps = {}

for (const file of fs.readdirSync(appsPath).filter((f) => f.endsWith('.js'))) {
  try {
    const name = file.replace('.js', '')
    const mod = await import(`./apps/${file}`)
    const className = name.charAt(0).toUpperCase() + name.slice(1)
    apps[name] = mod[className]
    if (!apps[name]) {
      logger.warn(`[星铁异相仲裁] 未找到导出类：${className} (${file})`)
    }
  } catch (err) {
    logger.error(`[星铁异相仲裁] 载入失败：${file}`)
    logger.error(err)
  }
}

export { apps }
