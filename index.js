import fs from 'node:fs'

const appsPath = `${import.meta.dirname}/apps`
const apps = {}

for (const file of fs.readdirSync(appsPath).filter((f) => f.endsWith('.js'))) {
  try {
    const name = file.replace('.js', '')
    apps[name] = (await import(`./apps/${file}`))[name.charAt(0).toUpperCase() + name.slice(1)]
  } catch (err) {
    logger.error(`[星铁异相仲裁] 载入失败：${file}`)
    logger.error(err)
  }
}

export { apps }
