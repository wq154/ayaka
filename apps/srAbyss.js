import plugin from '../../../lib/plugins/plugin.js'
import { segment } from 'oicq'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import lodash from 'lodash'
import MysInfo from '../../ji-plugin/model/mys/mysInfo.js'
import MysApi from '../../ji-plugin/model/mys/mysApi.js'
import LoveMys from '../../ji-plugin/model/loveMys.js'
import { Cfg } from '../../ji-plugin/model/tool/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const MODES = {
  abyss: {
    title: '忘却之庭·混沌回忆',
    short: '混沌',
    tag: 'STAR RAIL · MEMORY OF CHAOS',
    apiName: 'SpiralAbyss',
    totalFallback: 36,
    mainMetric: '轮次',
    command: '*深渊',
    prevCommand: '*上期深渊',
    noDataText: '混沌回忆数据还未更新'
  },
  story: {
    title: '虚构叙事·挑战回顾',
    short: '虚构',
    tag: 'STAR RAIL · PURE FICTION',
    apiName: 'Challenge_story',
    totalFallback: 12,
    mainMetric: '积分',
    command: '*虚构叙事',
    prevCommand: '*上期虚构叙事',
    noDataText: '虚构叙事数据还未更新'
  },
  boss: {
    title: '末日幻影·挑战回顾',
    short: '末日',
    tag: 'STAR RAIL · APOCALYPTIC SHADOW',
    apiName: 'Challenge_boss',
    totalFallback: 12,
    mainMetric: '积分',
    command: '*末日幻影',
    prevCommand: '*上期末日幻影',
    noDataText: '末日幻影数据还未更新'
  }
}

const CAPTCHA_CODES = [1034, 5003, 10035, 10041]

/**
 * 星铁深渊三队版：混沌回忆 / 虚构叙事 / 末日幻影
 * miao-plugin / ji-plugin 老模板固定 node_1、node_2，这里按接口实际 node_x 动态渲染，兼容三队。
 */
export class SrAbyss extends plugin {
  constructor () {
    super({
      name: '星铁深渊三队版',
      dsc: '查询星铁混沌/虚构/末日战绩，动态支持三队节点',
      event: 'message',
      // 放在 miao-plugin / ji-plugin 前面，优先接管星铁深渊类命令
      priority: -999999,
      rule: [
        {
          reg: '^(?:#星铁\\s*|\\*\\s*)(?:本期|上期|往期|历史)?\\s*(?:深渊|忘却之庭|忘却|混沌回忆|混沌|虚构叙事|虚构|末日幻影|末日)\\s*(?:本期|上期|往期|历史)?\\s*(?:[1-9]\\d{8,9})?$',
          fnc: 'srAbyss'
        }
      ]
    })
  }

  async srAbyss (e) {
    const modeKey = this.getMode(e.msg || '')
    const mode = MODES[modeKey]
    const isHistory = /(上期|往期|历史)/.test(e.msg || '')

    try {
      e.isSr = true
      e.game = 'sr'

      const uid = await this.getQueryUid(e)
      if (!uid) return true
      e.uid = uid

      const ck = await MysInfo.checkUidBing(uid, 'sr')
      if (!ck) {
        await this.replyNeedCk(e, uid)
        return true
      }
      e.srAbyssCk = ck

      const data = await this.getSrChallenge(e, mode, isHistory)
      if (!data) {
        await e.reply([`UID:${uid}，${mode.noDataText}，或 CK/战绩权限不可用~`, this.makeButtons(modeKey)])
        return true
      }
      if (data.exists_data === false || data.has_data === false) {
        await e.reply([`UID:${uid}，${mode.noDataText}哦~`, this.makeButtons(modeKey)])
        return true
      }

      const renderData = this.dealData(data, uid, modeKey, mode, isHistory)
      if (!renderData.hasData) {
        await e.reply([`UID:${uid}，${mode.noDataText}哦~`, this.makeButtons(modeKey)])
        return true
      }

      await this.render(e, renderData)
      return true
    } catch (err) {
      logger.error(`[星铁深渊三队版] ${mode.title} 查询异常`)
      logger.error(err)
      await e.reply([`${mode.short}查询失败：${err.message || err}`, this.makeButtons(modeKey)])
      return true
    }
  }

  getMode (msg = '') {
    if (/虚构/.test(msg)) return 'story'
    if (/末日/.test(msg)) return 'boss'
    return 'abyss'
  }

  async replyNeedCk (e, uid) {
    await e.reply([`UID:${uid} 暂无可用 Cookie，请先【#扫码登录】或【#刷新ck】后再试~`, segment.button([
      { text: '扫码登录', callback: '#扫码登录' },
      { text: '刷新Cookie', callback: '#刷新ck' }
    ])])
  }


  cleanCommandText (msg = '') {
    return String(msg || '')
      .replace(/\[CQ:(?:reply|at),[^\]]+\]/g, '')
      .replace(/<qqbot-at-[^>]+>/g, '')
      .trim()
  }

  async getQueryUid (e) {
    const rawMsg = e.msg || ''
    const cleanMsg = this.cleanCommandText(rawMsg)
    const msgUid = cleanMsg.match(/(?:UID|uid)?\s*([1-9]\d{8,9})/)?.[1]
    if (msgUid) return msgUid

    // 句首 @ 群友 + 星铁深渊类指令时，优先查询被 @ 人的绑定 UID。
    // 同时兼容部分适配器只给 message 段、还没写入 e.at 的情况。
    let at = e.at || ''
    if (!at && Array.isArray(e.message)) {
      const atSeg = e.message.find(i => i?.type === 'at' && String(i.qq || i.data?.qq || '') !== String(e.self_id) && String(i.qq || i.data?.qq || '') !== 'all')
      at = atSeg ? String(atSeg.qq || atSeg.data?.qq || '') : ''
    }
    if (at) e.at = at

    return await MysInfo.getUid(e)
  }

  async getSrChallenge (e, mode, isHistory = false) {
    const scheduleTypes = isHistory ? ['2', '3'] : ['1']
    for (const schedule_type of scheduleTypes) {
      const reqData = { schedule_type, isTask: true }
      let json
      try {
        json = await MysInfo.get(e, mode.apiName, reqData)
      } catch (err) {
        logger.error(`[星铁深渊三队版] 请求 ${mode.apiName} schedule_type=${schedule_type} 失败：${err}`)
        continue
      }

      if (json?.retcode === 0) {
        logger.mark(`[星铁深渊三队版] 接口命中：${mode.apiName} schedule_type=${schedule_type}`)
        return json.data
      }

      if (CAPTCHA_CODES.includes(Number(json?.retcode))) {
        logger.mark(`[星铁深渊三队版] ${mode.apiName} schedule_type=${schedule_type} 遇到验证码 ${json?.retcode}，尝试 ji-plugin 过码兜底`)
        const retry = await this.retryByJiGeetest(e, mode.apiName, reqData, json)
        if (retry?.retcode === 0) {
          logger.mark(`[星铁深渊三队版] 过码后接口命中：${mode.apiName} schedule_type=${schedule_type}`)
          return retry.data
        }
        logger.mark(`[星铁深渊三队版] 过码兜底失败：retcode=${retry?.retcode} ${retry?.message || ''}`)
      }

      logger.error(`[星铁深渊三队版] ${mode.apiName} schedule_type=${schedule_type} retcode=${json?.retcode} ${json?.message}`)
    }
    return false
  }

  async retryByJiGeetest (e, apiName, data = {}, raw = {}) {
    try {
      const ckUser = e.srAbyssCk || await MysInfo.checkUidBing(e.uid, 'sr')
      if (!ckUser?.ck) return raw

      // 优先复用 ji-plugin 的 handler；如果 runtime handler 未注册，再直接调用 loveMys。
      const mysApi = new MysApi(e.uid, ckUser.ck, 'sr', {}, ckUser.device || ckUser.device_id || '', ckUser.region || '')
      const handler = e.runtime?.handler || globalThis.Handler
      if (handler?.has?.('mys.req.err')) {
        const ret = await handler.call('mys.req.err', e, { mysApi, type: apiName, res: raw, data, mysInfo: null })
        if (ret?.retcode === 0) return ret
      }

      if (Cfg.api?.apiList?.ji?.token) {
        const loveMys = new LoveMys()
        const ret = await loveMys.getData(mysApi, apiName, { ...data, isTask: undefined })
        if (ret?.retcode === 0) return ret
      }

      if (Cfg.api?.GtestType === 3) return raw
      if ([1, 2].includes(Number(Cfg.api?.GtestType)) && (!Cfg.api?.api || !Cfg.api?.apiList?.[Cfg.api.api]?.token)) {
        logger.mark('[星铁深渊三队版] ji-plugin 未配置验证码 token，跳过自动过码')
        return raw
      }

      const loveMys = new LoveMys()
      return await loveMys.getvali(e, mysApi, apiName, { ...data, isTask: undefined }, Number(raw?.retcode) || 1034)
    } catch (err) {
      logger.error(`[星铁深渊三队版] ji-plugin 过码兜底异常：${err}`)
      return raw
    }
  }


  dealData (data, uid, modeKey, mode, isHistory) {
    const rawFloors = data.all_floor_detail || data.floors || data.floor_detail || []
    const floors = (rawFloors || [])
      .map((floor, idx) => this.formatFloor(floor, idx, mode))
      // 参考王棋：无挑战记录/无配队的层不展示。兼容可以从第三层开始打的情况。
      // 米游社会返回 0分/0星 的占位层，不能只靠 score/star 判断。
      .filter(f => f.hasRecord !== false && f.hasTeam)

    const floorMaxStar = lodash.sumBy(floors, (f) => Number(f.maxStar) || 0)
    const totalStar = Number(data.star_num ?? data.total_star ?? data.total_star_num ?? lodash.sumBy(floors, f => Number(f.star) || 0)) || 0
    const totalColoredStar = Number(data.extra_star_num ?? lodash.sumBy(floors, f => Number(f.coloredStar) || 0)) || 0
    const hasColoredStar = totalColoredStar > 0
    let maxStar = Number(data.max_star_num ?? data.max_star ?? data.star_total ?? data.total_star_limit ?? 0) || 0
    if (!maxStar) maxStar = Math.max(mode.totalFallback, floorMaxStar)
    if (maxStar < totalStar) maxStar = totalStar

    const bestFloor = this.getBestFloor(floors, mode)
    const scheduleTime = this.getScheduleTime(data)
    const metricTotal = this.getMetricTotal(data, floors, mode)
    const metricTotalText = this.formatLargeNumber(metricTotal)
    const metricTotalLabel = mode.mainMetric === '积分' ? '总分' : '使用轮次'

    return {
      uid,
      modeKey,
      modeName: isHistory ? '上期战绩' : '本期战绩',
      title: mode.title,
      tag: mode.tag,
      short: mode.short,
      modeShort: mode.short,
      mainMetric: mode.mainMetric,
      scheduleTime,
      totalStar,
      totalColoredStar,
      hasColoredStar,
      maxStar,
      maxFloor: data.max_floor || data.max_floor_name || bestFloor || '-',
      battleNum: data.battle_num || data.total_battle_num || '-',
      metricTotal,
      metricTotalText,
      metricTotalLabel,
      hasData: floors.length > 0,
      floors
    }
  }

  formatFloor (floor = {}, idx, mode) {
    let nodes = this.extractNodes(floor).map(({ key, node }, nIdx) => this.formatNode(node, nIdx, key, mode))
      .filter(node => node.hasRecord !== false && (node.avatars.length || node.hasExplicitRecord))

    const starInfo = this.formatStarInfo(floor)
    const star = starInfo.normal
    const coloredStar = starInfo.colored
    const totalDisplayStar = starInfo.total
    const scoreSum = lodash.sumBy(nodes, (n) => Number(n.score) || 0)
    const roundNum = floor.round_num ?? floor.round ?? floor.total_round ?? this.firstValue(nodes, 'roundNum') ?? ''
    const score = floor.allscore ?? floor.score ?? floor.total_score ?? (scoreSum || '')
    const firstTime = this.firstValue(nodes, 'time') || this.fmtTime(floor.challenge_time)
    const nodeCount = Math.max(nodes.length, 2)
    const maxStar = Number(floor.max_star_num ?? floor.max_star ?? floor.total_star_num ?? 3) || 3
    const hasRecord = floor.has_challenge_record ?? floor.has_record ?? floor.is_challenge ?? floor.is_unlock ?? true
    // 混沌回忆接口节点通常没有 score/round 字段，节点头部不要显示“暂无指标”，用本层星数兜底。
    nodes = nodes.map(node => ({
      ...node,
      metric: node.metric || `星数 ${star}/${maxStar}★`
    }))

    return {
      floorIndex: this.getFloorIndex(floor, idx),
      name: floor.name || floor.floor_name || floor.level_name || `第${idx + 1}层`,
      desc: floor.desc || floor.description || floor.name_mi18n || '',
      time: firstTime,
      star,
      coloredStar,
      coloredMax: starInfo.coloredMax,
      totalDisplayStar,
      maxStar,
      nodeCount,
      hasRecord,
      hasTeam: nodes.some(node => node.avatars.length > 0),
      roundNum,
      score,
      metricValue: mode.mainMetric === '积分' ? (score || '-') : (roundNum || '-'),
      nodes
    }
  }

  formatStarInfo (floor = {}) {
    // 星铁新三队接口已确认字段：star_num 为本层总星数，extra_star_num 为彩星数。
    // 例如四星启模式：star_num=4, extra_star_num=1 => 常规 3★ + 彩星 1★。
    const total = Number(floor.star_num ?? floor.star ?? floor.stars ?? floor.total_star_num ?? 0) || 0
    const colored = Number(floor.extra_star_num ?? 0) || 0
    const normal = Math.max(0, total - colored)
    return { total, normal, colored, coloredMax: colored > 0 ? colored : 0 }
  }

  pickDeepNumber (obj = {}, keys = [], kind = 'value') {
    const seen = new Set()
    let best = 0
    const walk = (cur) => {
      if (!cur || typeof cur !== 'object' || seen.has(cur)) return
      seen.add(cur)
      if (Array.isArray(cur)) {
        for (const item of cur) walk(item)
        return
      }

      for (const [key, value] of Object.entries(cur)) {
        const lower = key.toLowerCase()
        const direct = keys.some(k => lower === k.toLowerCase())
        const fuzzy = /star|medal/.test(lower) && /color|colour|special|extra|rainbow|full|medal/.test(lower)
        const isMax = /max|total|limit/.test(lower)
        const wanted = kind === 'max' ? (direct || (fuzzy && isMax)) : (direct || (fuzzy && !isMax))
        if (wanted) {
          const val = Number(value)
          if (!Number.isNaN(val) && val > best) best = val
        }
        walk(value)
      }
    }
    walk(obj)
    return best
  }

  hasColoredStarField (obj = {}) {
    return this.hasColoredStarFieldDeep(obj)
  }

  hasColoredStarFieldDeep (obj = {}, seen = new Set()) {
    if (!obj || typeof obj !== 'object' || seen.has(obj)) return false
    seen.add(obj)
    if (Array.isArray(obj)) return obj.some(item => this.hasColoredStarFieldDeep(item, seen))
    for (const [key, value] of Object.entries(obj)) {
      const lower = key.toLowerCase()
      if (/star|medal/i.test(lower) && /color|colour|special|extra|rainbow|full|medal|bonus|challenge/i.test(lower)) return true
      if (this.hasColoredStarFieldDeep(value, seen)) return true
    }
    return false
  }


  collectStarLikeFields (obj = {}, prefix = '', out = [], seen = new Set()) {
    if (!obj || typeof obj !== 'object' || seen.has(obj)) return out
    seen.add(obj)
    if (Array.isArray(obj)) {
      obj.slice(0, 6).forEach((item, idx) => this.collectStarLikeFields(item, `${prefix}[${idx}]`, out, seen))
      return out
    }
    for (const [key, value] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${key}` : key
      const lower = key.toLowerCase()
      if (/star|medal|color|colour|rainbow|special|extra/.test(lower)) {
        if (value == null || typeof value !== 'object') out.push(`${path}=${value}`)
        else out.push(`${path}=${Array.isArray(value) ? '[array]' : '[object]'}`)
      }
      this.collectStarLikeFields(value, path, out, seen)
    }
    return out
  }

  getFloorIndex (floor = {}, idx = 0) {
    const raw = floor.floor || floor.floor_id || floor.floor_num || floor.floor_index || floor.floor_level || floor.level || ''
    if (raw !== '' && raw !== undefined && raw !== null) return raw

    const name = String(floor.name || floor.floor_name || floor.level_name || '')
    // 优先解析“其四 / 第四层 / 难度四”这类真实层号，避免返回列表下标 1、2、3。
    const cn = name.match(/(?:其|第|难度)\s*([零〇一二两三四五六七八九十百]+)/)
    if (cn?.[1]) return this.parseChineseNumber(cn[1]) || idx + 1

    const num = name.match(/(?:其|第|难度|floor|Floor)\s*(\d+)/)
    if (num?.[1]) return num[1]

    const anyNum = name.match(/(\d+)/)
    return anyNum ? anyNum[1] : idx + 1
  }

  parseChineseNumber (str = '') {
    const map = { 零: 0, '〇': 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
    str = String(str).trim()
    if (!str) return 0
    if (map[str] !== undefined) return map[str]
    if (str === '十') return 10
    const m = str.match(/^([一二两三四五六七八九])?十([一二三四五六七八九])?$/)
    if (m) return (m[1] ? map[m[1]] : 1) * 10 + (m[2] ? map[m[2]] : 0)
    let ret = 0
    for (const ch of str) ret = ret * 10 + (map[ch] ?? 0)
    return ret
  }

  pickNumber (obj = {}, keys = []) {
    for (const key of keys) {
      const val = Number(obj?.[key])
      if (!Number.isNaN(val) && val > 0) return val
    }

    // 兜底：如果接口字段名变了，只要 key 里同时带 star 与 color/special/extra/medal，也视为彩色星。
    for (const [key, value] of Object.entries(obj || {})) {
      if (!/star|medal/i.test(key)) continue
      if (!/color|colour|special|extra|rainbow|full|medal/i.test(key)) continue
      const val = Number(value)
      if (!Number.isNaN(val) && val > 0) return val
    }
    return 0
  }

  extractNodes (floor = {}) {
    const keys = Object.keys(floor)
      .filter(k => /^node_\d+$/.test(k) && floor[k])
      .sort((a, b) => Number(a.split('_')[1]) - Number(b.split('_')[1]))

    if (keys.length) return keys.map(key => ({ key, node: floor[key] || {} }))

    // 兜底兼容旧字段或未来字段
    const fallback = []
    for (let i = 1; i <= 4; i++) {
      if (floor[`node${i}`]) fallback.push({ key: `node_${i}`, node: floor[`node${i}`] })
    }
    return fallback
  }

  formatNode (node = {}, idx, key, mode) {
    const buff = node.buff || node.maze_buff || node.field_buff || {}
    const score = node.score ?? node.total_score ?? node.damage ?? ''
    const roundNum = node.round_num ?? node.round ?? ''
    const time = this.fmtTime(node.challenge_time || node.time)
    const label = node.name || node.node_name || `节点${idx + 1}`
    const metric = mode.mainMetric === '积分'
      ? (score !== '' ? `积分 ${score}` : '')
      : (roundNum !== '' ? `轮次 ${roundNum}` : '')

    const avatars = this.formatAvatars(node.avatars || node.avatar_list || [])
    const hasRecord = node.has_challenge_record ?? node.has_record ?? node.is_challenge ?? true
    const hasExplicitRecord = Boolean(node.has_challenge_record || node.has_record || node.is_challenge)

    return {
      key,
      label,
      score,
      roundNum,
      time,
      metric,
      hasRecord,
      hasExplicitRecord,
      avatars,
      buffName: buff.name_mi18n || buff.name || '',
      buffDesc: buff.desc_mi18n || buff.desc || '',
      buffIcon: buff.icon || buff.image || ''
    }
  }

  formatAvatars (avatars = []) {
    return (avatars || []).map((a) => ({
      id: a.id || a.avatar_id,
      name: a.name || a.name_mi18n || '',
      level: a.level || '-',
      rarity: Number(a.rarity || a.rank_type || 5),
      rank: Number(a.rank ?? a.life ?? a.constellation ?? 0) || 0,
      element: a.element || '',
      icon: a.icon || a.image || a.avatar_icon || ''
    }))
  }

  firstValue (list = [], key) {
    for (const item of list) {
      const value = item?.[key]
      if (value !== undefined && value !== null && value !== '') return value
    }
    return ''
  }

  getMetricTotal (data = {}, floors = [], mode) {
    if (mode.mainMetric === '积分') {
      const direct = Number(data.total_score ?? data.score ?? data.allscore ?? data.totalScore ?? 0) || 0
      if (direct > 0) return direct

      // 米游社详情页的“总分”对应最高关卡/当前展示关卡的节点积分合计，
      // 不是所有历史层数相加；例如其四：40000+37120+40000=117120。
      const topFloor = lodash.maxBy(floors, f => Number(f.floorIndex) || 0) || lodash.maxBy(floors, f => Number(f.score) || 0)
      const score = Number(topFloor?.score) || 0
      if (score > 0) return score
      return lodash.max(floors.map(f => Number(f.score) || 0)) || 0
    }

    const directRound = Number(data.round_num ?? data.total_round ?? data.round ?? 0) || 0
    if (directRound > 0) return directRound
    const topFloor = lodash.maxBy(floors, f => Number(f.floorIndex) || 0) || floors[0]
    return Number(topFloor?.roundNum) || 0
  }

  formatLargeNumber (num) {
    num = Number(num) || 0
    if (!num) return '-'
    return String(num)
  }

  getBestFloor (floors = [], mode) {
    if (!floors.length) return '-'
    const best = lodash.maxBy(floors, (f) => {
      const main = mode.mainMetric === '积分' ? Number(f.score) || 0 : -(Number(f.roundNum) || 999)
      return (Number(f.star) || 0) * 100000 + main
    }) || floors[floors.length - 1]
    return best?.name ? `${best.name} ${best.star}/${best.maxStar}★` : '-'
  }

  getScheduleTime (data = {}) {
    const group = data.group || data.schedule || data.season || (Array.isArray(data.groups) ? (data.groups.find(g => g.status === 'New') || data.groups[0]) : {}) || {}
    const begin = this.fmtDateOnly(group.begin_time || data.begin_time || data.start_time)
    const end = this.fmtDateOnly(group.end_time || data.end_time || data.finish_time)
    const period = begin && end ? `${begin} - ${end}` : ''
    const name = group.name_mi18n || group.name || data.schedule_name || data.name || ''
    if (name && period) return `${name} · ${period}`
    if (period) return period
    if (group.game_version) return `${name} · ${group.game_version}`.replace(/^ · /, '')
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
    if (!t) return ''
    if (typeof t === 'string') return t
    if (typeof t === 'number') {
      const d = new Date(t * (t < 10000000000 ? 1000 : 1))
      if (!Number.isNaN(d.getTime())) return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
      return ''
    }
    if (!t.year && !t.month && !t.day) return ''
    const p = (n) => String(n || 0).padStart(2, '0')
    if (t.year) return `${t.year}-${p(t.month)}-${p(t.day)} ${p(t.hour)}:${p(t.minute)}`
    return `${t.month}/${t.day} ${p(t.hour)}:${p(t.minute)}`
  }

  makeBtn (text, input) {
    return {
      text,
      input,
      send: true,
      callback: input,
      clicked_text: input
    }
  }

  makeButtons (modeKey = '') {
    const rows = [[
      this.makeBtn('混沌', MODES.abyss.command),
      this.makeBtn('虚构', MODES.story.command),
      this.makeBtn('末日', MODES.boss.command),
      this.makeBtn('王棋', '*王棋')
    ]]

    if (modeKey && MODES[modeKey]) {
      rows.push([this.makeBtn(`上期${MODES[modeKey].short}`, MODES[modeKey].prevCommand)])
    }

    return segment.button(rows)
  }

  async render (e, data) {
    const tplFile = path.join(__dirname, '../resources/sr-abyss/index.html').replace(/\\/g, '/')
    const img = await this.renderImg(e, tplFile, data)
    if (img) {
      await e.reply([img, this.makeButtons(data.modeKey)])
      return true
    }

    const txt = [`${data.title} UID:${data.uid}`, `${data.modeName}${data.scheduleTime ? ` · ${data.scheduleTime}` : ''}`, `星数：${data.totalStar}/${data.maxStar}，最高：${data.maxFloor}，${data.metricTotalLabel}：${data.metricTotalText}`]
    data.floors.forEach((floor) => {
      txt.push(`${floor.name} ★${floor.star}/${floor.maxStar} ${data.mainMetric === '积分' ? '总分' : '使用轮次'}:${floor.metricValue}`)
      floor.nodes.forEach((node) => txt.push(`  ${node.label}：${node.avatars.map(a => a.name || a.id).filter(Boolean).join(' / ') || '无配队'}`))
    })
    await e.reply([txt.join('\n'), this.makeButtons(data.modeKey)])
    return true
  }

  async renderImg (e, tplFile, data) {
    try {
      const renderer = (await import('../../../lib/puppeteer/puppeteer.js')).default
      const base = path.join(__dirname, '../resources/').replace(/\\/g, '/')
      return await renderer.screenshot('sr-abyss-three-node', {
        tplFile,
        saveId: `${data.modeKey}-${Date.now()}`,
        imgType: 'png',
        _res_path: base,
        pluResPath: base,
        ...data,
        sys: { scale: 'style="transform-origin:0 0;"' }
      })
    } catch (err) {
      logger.error(`[星铁深渊三队版] 渲染异常 ${err}`)
      return false
    }
  }
}
