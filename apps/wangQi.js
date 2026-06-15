import md5 from 'md5'
import lodash from 'lodash'
import MysApi from '../../miao-plugin/models/MysApi.js'

/**
 * 星铁·异相仲裁（末日幻影 / challenge_boss）
 * 复用 TRSS/miao 的 UID -> CK -> 米游社 checkCode 全流程，和深渊查询一致。
 */
export class WangQi extends plugin {
  constructor () {
    super({
      name: '星铁异相仲裁',
      dsc: '查询崩坏：星穹铁道 异相仲裁(末日幻影) 战绩',
      event: 'message',
      priority: 800,
      rule: [
        {
          reg: '^(\\*|＊|#?星铁)?(王琪|异相仲裁|末日幻影)(上期)?$',
          fnc: 'arbitration'
        }
      ]
    })
  }

  async arbitration (e) {
    // 星铁标记必须在初始化前设置，TRSS 才会按 sr 绑定 UID/CK 查询
    e.isSr = true
    e.game = 'sr'

    // 和深渊一样：先拿查询 UID，再按 UID 查对应 CK/公共 CK
    let mys = await MysApi.init(e, 'all')
    if (!mys) return false

    let schedule = /上期/.test(e.msg) ? 2 : 1
    let data = await mys.getData('challenge_boss', { schedule_type: schedule })

    if (!data) {
      await e.reply('未获取到异相仲裁数据，可能本期未开启、战绩未公开或 CK 不可用~')
      return true
    }
    if (data.retcode && data.retcode !== 0) {
      await e.reply(`米游社接口返回异常：${data.message || data.retcode}`)
      return true
    }
    if (data.exists_data === false || data.has_data === false) {
      await e.reply('当前账号本期暂无异相仲裁战绩哦~')
      return true
    }

    let renderData = this.dealData(data, mys.uid)
    await this.render(e, renderData)
    return true
  }

  /** 整理渲染数据 */
  dealData (data, uid) {
    let groups = (data.groups || [])
    let cur = groups[0] || {}
    let floors = (data.all_floor_detail || data.floor_detail_list || []).map((f) => {
      let parseNode = (node = {}) => ({
        score: node.score || '0',
        defeatedNum: node.boss_defeated_num ?? '',
        avatars: (node.avatars || []).map((a) => ({
          id: a.id,
          level: a.level,
          rarity: a.rarity,
          rank: a.rank,
          element: a.element,
          icon: a.icon
        }))
      })
      return {
        name: f.name || f.floor_name || '未知区域',
        star: f.star_num ?? 0,
        roundNum: f.round_num ?? '',
        node1: parseNode(f.node_1),
        node2: parseNode(f.node_2),
        isFast: f.is_fast
      }
    })

    return {
      uid,
      scheduleTime: cur.begin_time && cur.end_time
        ? `${this.fmtTime(cur.begin_time)} ~ ${this.fmtTime(cur.end_time)}`
        : '',
      maxFloor: data.max_floor || data.max_floor_id || '-',
      battleNum: data.battle_num ?? '-',
      hasData: !!data.has_data,
      totalStar: lodash.sumBy(floors, (f) => Number(f.star) || 0),
      floors
    }
  }

  fmtTime (t = {}) {
    if (!t || !t.year) return ''
    let p = (n) => String(n).padStart(2, '0')
    return `${t.month}/${t.day} ${p(t.hour)}:${p(t.minute)}`
  }

  async render (e, data) {
    let tplFile = `${import.meta.dirname}/../resources/apocalyptic/index.html`
    let img = await this.renderImg(e, tplFile, data)
    if (img) {
      await e.reply(img)
    } else {
      // 渲染失败兜底文字
      let txt = [`星铁异相仲裁 UID:${data.uid}`, `周期：${data.scheduleTime || '本期'}`, `总星数：${data.totalStar}`]
      data.floors.forEach((f) => txt.push(`${f.name}  ★${f.star}`))
      await e.reply(txt.join('\n'))
    }
  }

  /** 调用 Yunzai 全局 puppeteer 渲染 */
  async renderImg (e, tplFile, data) {
    try {
      let renderer = (await import('../../../lib/puppeteer/puppeteer.js')).default
      let base = `${import.meta.dirname}/../resources/`
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
