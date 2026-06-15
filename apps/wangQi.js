import plugin from '../../../lib/plugins/plugin.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import lodash from 'lodash'
import fetch from 'node-fetch'
import MysApi from '../../miao-plugin/models/MysApi.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * TRSS-Yunzai 星铁·异相仲裁（王棋 / challenge_peak）
 * 复用 TRSS/miao 的 UID -> CK -> 米游社 checkCode 流程，像深渊一样按查询 UID 找 CK。
 */
export class WangQi extends plugin {
  constructor () {
    super({
      name: '星铁异相仲裁',
      dsc: '查询崩坏：星穹铁道 异相仲裁（王棋）战绩',
      event: 'message',
      priority: 800,
      rule: [
        {
          reg: '^(\\*|＊|#?星铁)?(王琪|王棋|异相仲裁)(上期|历史)?$',
          fnc: 'arbitration'
        }
      ]
    })
  }

  async arbitration (e) {
    try {
      e.isSr = true
      e.game = 'sr'

      // TRSS/miao 原生流程：取查询 UID -> 找该 UID 对应 CK/公共 CK
      let mys = await MysApi.init(e, 'all')
      if (!mys) return false

      // 米游社星铁前端 /rpg/arbitration/:type：current=2，history=3
      let scheduleType = /(上期|历史)/.test(e.msg) ? 3 : 2
      let data = await this.getChallengePeak(mys, scheduleType)

      if (!data) {
        await e.reply('未获取到异相仲裁数据，可能未开启、战绩未公开或 CK 不可用~')
        return true
      }
      if (data.exists_data === false || data.has_data === false) {
        await e.reply('当前账号暂无异相仲裁战绩哦~')
        return true
      }

      let renderData = this.dealData(data, mys.uid, scheduleType)
      await this.render(e, renderData)
      return true
    } catch (err) {
      logger.error('[异相仲裁] 查询异常')
      logger.error(err)
      await e.reply(`异相仲裁查询失败：${err.message || err}`)
      return true
    }
  }

  /**
   * 自包含调用 challenge_peak，不修改 TRSS/genshin 核心文件。
   * 但底层 headers、DS、device_fp、ck 仍复用 TRSS 的 MysApi。
   */
  async getChallengePeak (mys, scheduleType = 2) {
    let api = await mys.getMysApi(mys.e, 'all', { log: false })
    if (!api) return false

    // 确保 device_fp 初始化，和 TRSS 其他米游社接口一致
    try {
      if (!api._device_fp) await api.getData('getFp')
    } catch (err) {
      logger.warn(`[异相仲裁] 获取 device_fp 失败：${err}`)
    }

    let query = `role_id=${api.uid}&server=${api.server}&schedule_type=${scheduleType}`
    let url = `https://api-takumi-record.mihoyo.com/game_record/app/hkrpg/api/challenge_peak?${query}`
    if (!/cn|_cn/.test(api.server)) {
      url = `https://bbs-api-os.hoyolab.com/game_record/app/hkrpg/api/challenge_peak?${query}`
    }

    let headers = {
      ...api.getHeaders(query, ''),
      Cookie: api.cookie
    }
    if (api._device_fp?.data?.device_fp) {
      headers['x-rpc-device_fp'] = api._device_fp.data.device_fp
    }

    let json
    try {
      let res = await fetch(url, { method: 'get', headers, timeout: 10000 })
      json = await res.json()
    } catch (err) {
      logger.error(`[异相仲裁] 请求 challenge_peak 失败：${err}`)
      return false
    }

    json.api = 'challenge_peak'
    if (mys.mysInfo?.checkCode) {
      json = await mys.mysInfo.checkCode(json, 'challenge_peak', api, { schedule_type: scheduleType })
    }

    if (!json || json.retcode !== 0) {
      logger.error(`[异相仲裁] challenge_peak retcode=${json?.retcode} ${json?.message}`)
      return false
    }
    return json.data
  }

  /** 整理 challenge_peak 渲染数据 */
  dealData (data, uid, scheduleType) {
    let records = data.challenge_peak_records || []
    let first = records[0] || {}
    let brief = {
      ...(data.challenge_peak_best_record_brief || {}),
      has_challenge_record: first.has_challenge_record,
      group: first.group || data.group || data.challenge_peak_best_record_brief?.group || {}
    }

    let floors = records.map((r, idx) => {
      let info = r.boss_info || {}
      let record = r.boss_record || {}
      let buff = record.buff || {}
      return {
        name: info.name_mi18n || info.hard_mode_name_mi18n || info.name || `王棋 ${idx + 1}`,
        star: record.star_num ?? 0,
        roundNum: record.round_num ?? '-',
        score: record.score ?? record.round_num ?? '-',
        time: this.fmtTime(record.challenge_time),
        buffName: buff.name_mi18n || buff.name || '',
        hasRecord: record.has_challenge_record ?? r.has_challenge_record ?? false,
        node1: {
          score: record.round_num ?? '-',
          avatars: this.formatAvatars(record.avatars || [])
        },
        node2: { score: '', avatars: [] }
      }
    })

    let totalStar = (brief.boss_stars ?? lodash.sumBy(floors, (f) => Number(f.star) || 0)) || 0
    let mobStar = brief.mob_stars ?? 0
    let group = brief.group || {}

    return {
      uid,
      modeName: scheduleType === 3 ? '历史战绩' : '本期战绩',
      scheduleTime: group.game_version
        ? `${group.name_mi18n || '异相仲裁'} · ${group.game_version}`
        : (group.name_mi18n || ''),
      maxFloor: brief.challenge_peak_rank_icon_type || '-',
      battleNum: brief.total_battle_num ?? '-',
      hasData: !!records.length,
      totalStar,
      mobStar,
      floors
    }
  }

  formatAvatars (avatars = []) {
    return avatars.map((a) => ({
      id: a.id || a.avatar_id,
      level: a.level,
      rarity: a.rarity,
      rank: a.rank,
      element: a.element,
      icon: a.icon || a.image
    }))
  }

  fmtTime (t = {}) {
    if (!t || !t.year) return ''
    let p = (n) => String(n || 0).padStart(2, '0')
    return `${t.month}/${t.day} ${p(t.hour)}:${p(t.minute)}`
  }

  async render (e, data) {
    let tplFile = path.join(__dirname, '../resources/apocalyptic/index.html').replace(/\\/g, '/')
    let img = await this.renderImg(e, tplFile, data)
    if (img) {
      await e.reply(img)
    } else {
      let txt = [`星铁异相仲裁 UID:${data.uid}`, `${data.modeName} ${data.scheduleTime || ''}`, `王棋星数：${data.totalStar}，骑士星数：${data.mobStar}`]
      data.floors.forEach((f) => txt.push(`${f.name}  ★${f.star}  轮次:${f.roundNum}`))
      await e.reply(txt.join('\n'))
    }
  }

  async renderImg (e, tplFile, data) {
    try {
      let renderer = (await import('../../../lib/puppeteer/puppeteer.js')).default
      let base = path.join(__dirname, '../resources/').replace(/\\/g, '/')
      return await renderer.screenshot('sr-apocalyptic', {
        tplFile,
        _res_path: base,
        pluResPath: base,
        ...data,
        sys: { scale: 'style=transform:scale(1.0)' }
      })
    } catch (err) {
      logger.error(`[异相仲裁] 渲染异常 ${err}`)
      return false
    }
  }
}
