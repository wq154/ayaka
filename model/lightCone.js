import MysInfo from '../../ji-plugin/model/mys/mysInfo.js'
import MysApi from '../../ji-plugin/model/mys/mysApi.js'
import LoveMys from '../../ji-plugin/model/loveMys.js'
import { Cfg } from '../../ji-plugin/model/tool/index.js'

/** 米游社风控码：遇到这些就走过码兜底 */
export const CAPTCHA_CODES = [10035, 10041, 1034, 5003]

/**
 * ji-plugin 过码兜底（深渊 / 王棋 等共用）。
 * 优先复用 runtime 里注册的 mys.req.err handler，其次直接用 loveMys 补验证码。
 */
export async function retryByJiGeetest (e, apiName, data = {}, raw = {}) {
  try {
    const ckUser = e.srAbyssCk || await MysInfo.checkUidBing(e.uid, 'sr')
    if (!ckUser?.ck) return raw

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
      logger.mark(`[${apiName}] ji-plugin 未配置验证码 token，跳过自动过码`)
      return raw
    }

    const loveMys = new LoveMys()
    return await loveMys.getvali(e, mysApi, apiName, { ...data, isTask: undefined }, Number(raw?.retcode) || 1034)
  } catch (err) {
    logger.error(`[${apiName}] ji-plugin 过码兜底异常：${err}`)
    return raw
  }
}

/**
 * 拉当前 UID 的角色列表 → Map(角色 id -> 光锥)
 * 米游社深渊/王棋接口都不返回光锥，只能另外走「角色列表」接口 avatar_list 的 equip 字段。
 * @returns {Map|null} 拿不到时返回 null（调用方保持“没有光锥那一行”即可）
 */
export async function fetchEquipMap (e, tag = '星铁') {
  let res = await MysInfo.get(e, 'Character', { cached: true, isTask: true })
  if (res?.retcode !== 0 && CAPTCHA_CODES.includes(Number(res?.retcode))) {
    logger.mark(`[${tag}] 角色列表遇到验证码 ${res?.retcode}，尝试 ji-plugin 过码兜底`)
    const retry = await retryByJiGeetest(e, 'Character', { need_wiki: true }, res)
    if (retry?.retcode === 0) res = retry
  }

  const list = res?.data?.avatar_list
  if (res?.retcode !== 0 || !Array.isArray(list)) {
    logger.mark(`[${tag}] 光锥信息不可用：retcode=${res?.retcode} ${res?.message || ''}`)
    return null
  }

  const equipMap = new Map()
  for (const item of list) {
    const equip = item?.equip || {}
    if (!item?.id || !equip.id) continue
    equipMap.set(String(item.id), {
      id: equip.id,
      name: equip.name || item.name_mi18n || item.name || '',
      icon: equip.icon || equip.image || '',
      rarity: Number(equip.rarity) || 0,
      level: Number(equip.level) || 0,
      affix: Number(equip.rank) || 0
    })
  }
  return equipMap.size ? equipMap : null
}

/**
 * 给若干组角色数组补 equip(光锥)
 * @param {Array<Array>} groups 角色数组的集合，元素为 { id, ... }
 * @returns {number} 命中的角色数
 */
export function attachEquip (groups = [], equipMap = null) {
  if (!equipMap) return 0
  let hit = 0
  for (const list of groups) {
    for (const avatar of list || []) {
      const equip = equipMap.get(String(avatar?.id)) || null
      if (!avatar) continue
      avatar.equip = equip
      if (equip) hit++
    }
  }
  return hit
}
