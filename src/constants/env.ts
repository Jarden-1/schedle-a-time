/**
 * 环境常量。
 *
 * 单独抽出来是为了避免 services/api 与 services/telemetry 互相 import 形成循环依赖。
 */
export const BASE_URL = API_BASE_URL || 'https://api.zhanghaoyang.cn/api';
export const UPLOAD_URL = `${BASE_URL}/upload`;
