export interface HotboardPlatform {
  type: string;
  label: string;
}

export const HOTBOARD_PLATFORMS: HotboardPlatform[] = [
  { type: 'bilibili', label: '哔哩哔哩' },
  { type: 'acfun', label: 'A站' },
  { type: 'weibo', label: '微博热搜' },
  { type: 'zhihu', label: '知乎热榜' },
  { type: 'zhihu-daily', label: '知乎日报' },
  { type: 'douyin', label: '抖音' },
  { type: 'kuaishou', label: '快手' },
  { type: 'douban-movie', label: '豆瓣电影' },
  { type: 'douban-group', label: '豆瓣小组' },
  { type: 'tieba', label: '百度贴吧' },
  { type: 'hupu', label: '虎扑' },
  { type: 'ngabbs', label: 'NGA论坛' },
  { type: 'v2ex', label: 'V2EX' },
  { type: '52pojie', label: '吾爱破解' },
  { type: 'hostloc', label: '全球主机交流' },
  { type: 'coolapk', label: '酷安' },
  { type: 'baidu', label: '百度热搜' },
  { type: 'thepaper', label: '澎湃新闻' },
  { type: 'toutiao', label: '今日头条' },
  { type: 'qq-news', label: '腾讯新闻' },
  { type: 'sina', label: '新浪热搜' },
  { type: 'sina-news', label: '新浪新闻' },
  { type: 'netease-news', label: '网易新闻' },
  { type: 'huxiu', label: '虎嗅' },
  { type: 'ifanr', label: '爱范儿' },
  { type: 'sspai', label: '少数派' },
  { type: 'ithome', label: 'IT之家' },
  { type: 'ithome-xijiayi', label: 'IT之家喜加一' },
  { type: 'juejin', label: '掘金' },
  { type: 'jianshu', label: '简书' },
  { type: 'guokr', label: '果壳' },
  { type: '36kr', label: '36氪' },
  { type: '51cto', label: '51CTO' },
  { type: 'csdn', label: 'CSDN' },
  { type: 'nodeseek', label: 'NodeSeek' },
  { type: 'hellogithub', label: 'HelloGitHub' },
  { type: 'lol', label: '英雄联盟' },
  { type: 'genshin', label: '原神' },
  { type: 'honkai', label: '崩坏3' },
  { type: 'starrail', label: '星穹铁道' },
  { type: 'netease-music', label: '网易云音乐热歌榜' },
  { type: 'qq-music', label: 'QQ音乐热歌榜' },
  { type: 'weread', label: '微信读书' },
  { type: 'weatheralarm', label: '天气预警' },
  { type: 'earthquake', label: '地震速报' },
  { type: 'history', label: '历史上的今天' },
];

export const DEFAULT_HOTBOARD_PLATFORM_TYPES = [
  'weibo',
  'zhihu',
  'bilibili',
  'douyin',
  'kuaishou',
  'toutiao',
  'baidu',
  'hupu',
  'v2ex',
  'juejin',
  'csdn',
];

const HOTBOARD_PLATFORM_TYPE_SET = new Set(HOTBOARD_PLATFORMS.map((platform) => platform.type));

export function normalizeHotboardPlatformTypes(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[,，\s/]+/)
        .map((item) => item.trim().toLowerCase())
        .filter((item) => HOTBOARD_PLATFORM_TYPE_SET.has(item))
    )
  );
}
