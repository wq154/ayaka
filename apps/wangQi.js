import plugin from '../../../lib/plugins/plugin.js'
import { segment } from 'oicq'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import lodash from 'lodash'
import MysInfo from '../../ji-plugin/model/mys/mysInfo.js'

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
      priority: -999999,
      rule: [
        {
          reg: '^(?:(?:\\*|＊)|#?星铁|#)?\\s*(?:王琪|王棋|异相仲裁)\\s*(?:(?:上期|历史)\\s*)?(?:[+＋]?\\s*(?:UID|uid)?\\s*[1-9]\\d{8,9}\\s*)?(?:(?:上期|历史)\\s*)?$',
          fnc: 'arbitration'
        }
      ]
    })
  }

  async arbitration (e) {
    try {
      e.isSr = true
      e.game = 'sr'

      const rawMsg = e.msg || ''
      e.msg = this.normalizeQueryMsg(rawMsg)

      // 直接复用 ji-plugin/末日幻影同款 MysInfo 链路，含 CK 匹配、device_fp、验证码 handler。
      // 先吃掉消息里显式写的 UID，避免官方 QQBot openid 场景下被绑定信息影响。
      const uid = await this.getQueryUid(e)
      if (!uid) return true
      e.uid = uid

      const ck = await MysInfo.checkUidBing(uid, 'sr')
      if (!ck) {
        await this.replyNeedCk(e, uid)
        return true
      }

      const isHistory = /(上期|历史)/.test(e.msg)
      let data = await this.getChallengePeak(e, isHistory)

      if (!data) {
        await e.reply(['未获取到异相仲裁数据，可能未开启、战绩未公开或 CK 不可用~', this.makeButtons()])
        return true
      }
      if (data.exists_data === false || data.has_data === false) {
        await e.reply(['当前账号暂无异相仲裁战绩哦~', this.makeButtons()])
        return true
      }

      let renderData = this.dealData(data, uid, isHistory)
      await this.render(e, renderData)
      return true
    } catch (err) {
      logger.error('[异相仲裁] 查询异常')
      logger.error(err)
      await e.reply([`异相仲裁查询失败：${err.message || err}`, this.makeButtons()])
      return true
    }
  }

  normalizeQueryMsg (msg = '') {
    return String(msg || '')
      .replace(/[+＋]\s*(?=(?:UID|uid)?\s*[1-9]\d{8,9})/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  cleanCommandText (msg = '') {
    return String(msg || '')
      .replace(/\[CQ:(?:reply|at),[^\]]+\]/g, '')
      .replace(/<qqbot-at-[^>]+>/g, '')
      .trim()
  }

  getUidFromMsg (msg = '') {
    const m = this.cleanCommandText(msg).match(/(?:UID|uid)?\s*([1-9]\d{8,9})/)
    return m?.[1] || ''
  }


  async replyNeedCk (e, uid) {
    await e.reply([`UID:${uid} 暂无可用 Cookie，请先【#扫码登录】或【#刷新ck】后再试~`, segment.button([
      { text: '扫码登录', callback: '#扫码登录' },
      { text: '刷新Cookie', callback: '#刷新ck' }
    ])])
  }

  async getQueryUid (e) {
    const msgUid = this.getUidFromMsg(e.msg)
    if (msgUid) return msgUid

    let at = e.at || ''
    if (!at && Array.isArray(e.message)) {
      const seg = e.message.find(i => i?.type === 'at' && String(i.qq || i.data?.qq || '') !== String(e.self_id) && String(i.qq || i.data?.qq || '') !== 'all')
      at = String(seg?.qq || seg?.data?.qq || '')
    }
    if (at) e.at = at

    return await MysInfo.getUid(e)
  }

  toBool (val) {
    if (val === true) return true
    if (val === false || val === undefined || val === null || val === '') return false
    if (typeof val === 'number') return val > 0
    const text = String(val).trim().toLowerCase()
    return ['1', 'true', 'yes', 'y', 'on'].includes(text)
  }

  normalizeIcon (icon = '') {
    if (!icon) return ''
    if (typeof icon === 'string') return icon
    if (typeof icon === 'object') return icon.icon || icon.image || icon.url || icon.src || ''
    return ''
  }

  /**
   * 按星铁深渊类接口写法查询异相仲裁。
   * 参考混沌回忆/虚构叙事/末日幻影：schedule_type + need_all=true + isPrev=true。
   * 新接口优先用 challenge_peak；环境接口表较旧时回退 challenge_boss。
   */
  async getChallengePeak (e, isHistory = false) {
    const scheduleTypes = isHistory ? ['2', '3', '1'] : ['1', '2', '3']
    const candidates = []

    for (const schedule_type of scheduleTypes) {
      candidates.push({ apiName: 'Challenge_peak', params: { schedule_type } })
    }
    // 若当前接口表或米游社未开放 peak，则回退 boss 验证链路，至少能确认验证码链路通畅
    for (const schedule_type of scheduleTypes) {
      candidates.push({ apiName: 'Challenge_boss', params: { schedule_type } })
    }

    const tried = new Set()
    for (const { apiName, params } of candidates) {
      const key = `${apiName}:${JSON.stringify(params)}`
      if (tried.has(key)) continue
      tried.add(key)

      let json
      try {
        json = await MysInfo.get(e, apiName, params)
      } catch (err) {
        logger.error(`[异相仲裁] 请求 ${apiName} ${JSON.stringify(params)} 失败：${err}`)
        continue
      }

      if (json?.retcode === 0) {
        logger.mark(`[异相仲裁] 接口命中：${apiName} ${JSON.stringify(params)}`)
        return json.data
      }
      logger.error(`[异相仲裁] ${apiName} ${JSON.stringify(params)} retcode=${json?.retcode} ${json?.message}`)
    }
    return false
  }


  dealData (data, uid, isHistory) {
    let records = data.challenge_peak_records || data.records || data.all_floor_detail || []
    let first = records[0] || {}
    let brief = {
      ...(data.challenge_peak_best_record_brief || data.best_record_brief || data.brief || {}),
      has_challenge_record: first.has_challenge_record,
      group: first.group || data.group || data.challenge_peak_best_record_brief?.group || data.best_record_brief?.group || {}
    }

    let floors = records.map((r, idx) => {
      let info = r.boss_info || r.enemy_info || r.monster_info || r.common_info || {}
      let record = r.boss_record || r.record || r
      let node1 = record.node_1 || record.node1 || record
      let node2 = record.node_2 || record.node2 || {}
      let buff1 = node1.buff || record.buff || r.buff || {}
      let buff2 = node2.buff || {}
      let time = node1.challenge_time || record.challenge_time || r.challenge_time || {}
      let mobs = this.formatMobs(r.mob_infos || [], r.mob_records || [])
      let bossTeam = this.formatAvatars(record.avatars || node1.avatars || [])
      let mobStarSum = lodash.sumBy(mobs, (m) => Number(m.star) || 0)
      let bossStar = Number(record.star_num ?? record.star ?? r.boss_stars ?? 0) || 0
      let star = bossStar + mobStarSum
      let maxStar = 3 + mobs.length * 3
      let score1 = node1.score ?? node1.round_num ?? record.score ?? record.round_num ?? '-'
      let score2 = mobStarSum || 0
      let totalScore = record.score ?? r.score ?? ((Number(score1) || 0) + (Number(score2) || 0))
      const hasFinishColorMedalField = record.finish_color_medal !== undefined || r.finish_color_medal !== undefined
      const finishColorMedal = this.toBool(record.finish_color_medal ?? r.finish_color_medal ?? false)
      const rankIconType = record.challenge_peak_rank_icon_type ?? r.challenge_peak_rank_icon_type ?? ''
      const colorMedalIcon = this.normalizeIcon(record.challenge_peak_rank_icon ?? r.challenge_peak_rank_icon ?? '')
      // 有 finish_color_medal 时以它为准；没有该字段时再用 rank_icon 兜底，避免普通战绩也误显示彩框。
      const hasColorMedal = hasFinishColorMedalField ? finishColorMedal : (!!colorMedalIcon && Number(rankIconType) > 0)

      return {
        name: info.name_mi18n || info.hard_mode_name_mi18n || info.name || r.name || `王棋 ${idx + 1}`,
        subName: info.hard_mode_name_mi18n || info.level_name_mi18n || info.desc_mi18n || '',
        star,
        bossStar,
        mobStar: mobStarSum,
        maxStar,
        finishColorMedal,
        hasColorMedal,
        rankIconType,
        colorMedalIcon,
        roundNum: record.round_num ?? node1.round_num ?? '-',
        score: totalScore ?? '-',
        time: this.fmtTime(time),
        mobs,
        buffName: buff1.name_mi18n || buff1.name || '',
        buffDesc: buff1.desc_mi18n || buff1.desc || '',
        buffIcon: buff1.icon || '',
        buff2Name: buff2.name_mi18n || buff2.name || '',
        buff2Desc: buff2.desc_mi18n || buff2.desc || '',
        buff2Icon: buff2.icon || '',
        hasRecord: record.has_challenge_record ?? r.has_challenge_record ?? false,
        detailText: [
          info.tag_mi18n || info.tag || '',
          info.weakness || info.weaknesses || '',
          record.result || record.rank || ''
        ].filter(Boolean).join(' · '),
        node1: {
          label: '王棋',
          score: score1,
          avatars: bossTeam
        },
        node2: {
          label: '节点2',
          score: score2,
          avatars: this.formatAvatars(node2.avatars || [])
        }
      }
    }).filter(f => f.hasRecord !== false || f.node1.avatars.length || f.node2.avatars.length)

    let bossStar = lodash.sumBy(floors, (f) => Number(f.bossStar) || 0)
    let mobStar = lodash.sumBy(floors, (f) => Number(f.mobStar) || 0)
    let totalStar = bossStar + mobStar
    let group = brief.group || {}
    let maxStar = Math.max(totalStar, lodash.sumBy(floors, (f) => Number(f.maxStar) || 0), 12)
    let bestFloor = lodash.maxBy(floors, (f) => Number(f.star) * 1000 - (f.roundNum === undefined || f.roundNum === null || f.roundNum === '' ? 999 : Number(f.roundNum))) || {}
    let maxFloor = bestFloor.name
      ? `${bestFloor.name} ${bestFloor.star}/${bestFloor.maxStar}★`
      : '-'
    let metricTotal = Number(bestFloor.roundNum) || 0
    let metricTotalText = metricTotal ? String(metricTotal) : '-'
    let scheduleTime = this.getScheduleTime(data, group)
    const colorMedalFloor = floors.find(f => f.hasColorMedal) || {}
    const hasColorMedal = !!colorMedalFloor.hasColorMedal
    const colorMedalIcon = colorMedalFloor.colorMedalIcon || ''

    return {
      uid,
      modeName: isHistory ? '历史战绩' : '本期战绩',
      title: '异相仲裁挑战回顾',
      scheduleTime,
      maxFloor,
      maxFloorText: bestFloor.name ? `${this.shortText(bestFloor.name, 7)} ${bestFloor.star}/${bestFloor.maxStar}★` : '-',
      battleNum: lodash.sumBy(records, (r) => Number(r.battle_num) || 0) || brief.total_battle_num || brief.battle_num || data.battle_num || '-',
      metricTotal,
      metricTotalText,
      metricTotalLabel: '使用轮次',
      hasData: !!floors.length,
      hasColorMedal,
      colorMedalIcon,
      bossStar,
      totalStar,
      mobStar,
      maxStar,
      starRange: Array.from({ length: maxStar }, (_, i) => i + 1),
      floors
    }
  }

  formatMobs (mobInfos = [], mobRecords = []) {
    const recordMap = new Map()
    for (const r of mobRecords || []) {
      const keys = [r.id, r.mob_id, r.monster_id, r.maze_id, r.unique_id, r.name, r.name_mi18n].filter(v => v !== undefined && v !== null)
      for (const k of keys) recordMap.set(String(k), r)
    }

    const list = (mobInfos || []).map((m, idx) => {
      const keys = [m.id, m.mob_id, m.monster_id, m.maze_id, m.unique_id, m.name, m.name_mi18n].filter(v => v !== undefined && v !== null)
      let rec = {}
      for (const k of keys) {
        if (recordMap.has(String(k))) {
          rec = recordMap.get(String(k))
          break
        }
      }
      rec = rec || mobRecords?.[idx] || {}
      return {
        id: m.id || m.mob_id || m.monster_id || rec.id || rec.mob_id || idx,
        name: m.name_mi18n || m.name || rec.name_mi18n || rec.name || `棋子${idx + 1}`,
        icon: m.icon || m.image || m.avatar_icon || rec.icon || rec.image || '',
        level: m.level || rec.level || '',
        type: m.type_mi18n || m.type || rec.type_mi18n || rec.type || '',
        star: rec.star_num ?? rec.star ?? m.star_num ?? '',
        roundNum: rec.round_num ?? '',
        roundText: (rec.round_num ?? '') === '' ? '' : `轮次 ${rec.round_num ?? ''}`,
        buffName: rec.buff?.name_mi18n || rec.buff?.name || rec.maze_buff?.name_mi18n || rec.maze_buff?.name || rec.field_buff?.name_mi18n || rec.field_buff?.name || m.buff?.name_mi18n || m.buff?.name || m.maze_buff?.name_mi18n || m.maze_buff?.name || '',
        buffDesc: rec.buff?.desc_mi18n || rec.buff?.desc || rec.maze_buff?.desc_mi18n || rec.maze_buff?.desc || rec.field_buff?.desc_mi18n || rec.field_buff?.desc || m.buff?.desc_mi18n || m.buff?.desc || m.maze_buff?.desc_mi18n || m.maze_buff?.desc || '',
        buffIcon: rec.buff?.icon || rec.maze_buff?.icon || rec.field_buff?.icon || m.buff?.icon || m.maze_buff?.icon || '',
        isFast: rec.is_fast ?? false,
        score: rec.score ?? rec.round_num ?? rec.damage ?? '',
        status: rec.status_mi18n || rec.status || (rec.is_killed ? '已击破' : ''),
        avatars: this.formatAvatars(rec.avatars || []),
        weakness: this.formatWeakness(m.weakness || m.weaknesses || m.weak_element_list || rec.weakness || rec.weaknesses || [])
      }
    })

    if (list.length) return list
    return (mobRecords || []).map((r, idx) => ({
      id: r.id || r.mob_id || idx,
      name: r.name_mi18n || r.name || `棋子${idx + 1}`,
      icon: r.icon || r.image || '',
      level: r.level || '',
      type: r.type_mi18n || r.type || '',
      star: r.star_num ?? r.star ?? '',
      roundNum: r.round_num ?? '',
      roundText: (r.round_num ?? '') === '' ? '' : `轮次 ${r.round_num ?? ''}`,
      buffName: r.buff?.name_mi18n || r.buff?.name || r.maze_buff?.name_mi18n || r.maze_buff?.name || r.field_buff?.name_mi18n || r.field_buff?.name || '',
      buffDesc: r.buff?.desc_mi18n || r.buff?.desc || r.maze_buff?.desc_mi18n || r.maze_buff?.desc || r.field_buff?.desc_mi18n || r.field_buff?.desc || '',
      buffIcon: r.buff?.icon || r.maze_buff?.icon || r.field_buff?.icon || '',
      isFast: r.is_fast ?? false,
      score: r.score ?? r.round_num ?? r.damage ?? '',
      status: r.status_mi18n || r.status || (r.is_killed ? '已击破' : ''),
      avatars: this.formatAvatars(r.avatars || []),
      weakness: this.formatWeakness(r.weakness || r.weaknesses || r.weak_element_list || [])
    }))
  }

  formatWeakness (weakness = []) {
    if (typeof weakness === 'string') return weakness
    if (!Array.isArray(weakness)) return ''
    return weakness.map(w => {
      if (typeof w === 'string') return w
      return w.name_mi18n || w.name || w.element || w.type || ''
    }).filter(Boolean).join(' / ')
  }

  formatAvatars (avatars = []) {
    return avatars.map((a) => ({
      id: a.id || a.avatar_id,
      name: a.name || a.name_mi18n || '',
      level: a.level,
      rarity: a.rarity,
      rank: a.rank ?? a.life ?? a.constellation ?? 0,
      element: a.element,
      icon: a.icon || a.image
    }))
  }

  shortText (text = '', max = 18) {
    text = String(text || '')
    if (text.length <= max) return text
    return `${text.slice(0, max)}…`
  }

  getScheduleTime (data = {}, group = {}) {
    group = group || {}
    const begin = this.fmtDateOnly(group.begin_time || data.begin_time || data.start_time)
    const end = this.fmtDateOnly(group.end_time || data.end_time || data.finish_time)
    const period = begin && end ? `${begin} - ${end}` : ''
    const name = group.name_mi18n || group.name || data.schedule_name || '异相仲裁'
    if (period) return `${name} · ${period}`
    if (group.game_version) return `${name} · ${group.game_version}`
    return name
  }

  fmtDateOnly (t = {}) {
    if (!t) return ''
    if (typeof t === 'number') {
      const d = new Date(t * (t < 10000000000 ? 1000 : 1))
      if (!Number.isNaN(d.getTime())) return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
      return ''
    }
    if (typeof t === 'string') return t.replace(/-/g, '.')
    if (!t.year && !t.month && !t.day) return ''
    return `${t.year}.${String(t.month || 0).padStart(2, '0')}.${String(t.day || 0).padStart(2, '0')}`
  }

  fmtTime (t = {}) {
    if (!t || !t.year) return ''
    let p = (n) => String(n || 0).padStart(2, '0')
    return `${t.month}/${t.day} ${p(t.hour)}:${p(t.minute)}`
  }

  makeBtn (text, input) {
    // 按“面板”那种按钮消息写法：点击后把指令填入并直接发送
    return {
      text,
      input,
      send: true,
      clicked_text: input
    }
  }

  makeButtons () {
    // 五分钟内被动回复按钮：随 e.reply 发出，不走主动消息额度。按钮保持少量常用入口。
    return segment.button([
      [
        this.makeBtn('混沌', '*深渊'),
        this.makeBtn('虚构', '*虚构叙事'),
        this.makeBtn('末日', '*末日幻影'),
        this.makeBtn('王棋', '*王棋')
      ]
    ])
  }

  async render (e, data) {
    let tplFile = path.join(__dirname, '../resources/apocalyptic/index.html').replace(/\\/g, '/')
    let img = await this.renderImg(e, tplFile, data)
    if (img) {
      await e.reply([img, this.makeButtons()])
    } else {
      let txt = [`星铁异相仲裁 UID:${data.uid}`, `${data.modeName} ${data.scheduleTime || ''}`, `王棋星数：${data.totalStar}，骑士星数：${data.mobStar}`]
      data.floors.forEach((f) => txt.push(`${f.name}  ★${f.star}  轮次:${f.roundNum}`))
      await e.reply([txt.join('\n'), this.makeButtons()])
    }
  }

  async renderImg (e, tplFile, data) {
    try {
      let renderer = (await import('../../../lib/puppeteer/puppeteer.js')).default
      let base = path.join(__dirname, '../resources/').replace(/\\/g, '/')
      return await renderer.screenshot('sr-apocalyptic', {
        tplFile,
        saveId: `wangqi-${Date.now()}`,
        imgType: 'png',
        _res_path: base,
        pluResPath: base,
        ...data,
        sys: { scale: 'style="transform-origin:0 0;"' }
      })
    } catch (err) {
      logger.error(`[异相仲裁] 渲染异常 ${err}`)
      return false
    }
  }
}
