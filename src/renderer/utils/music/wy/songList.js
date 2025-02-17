// https://github.com/Binaryify/NeteaseCloudMusicApi/blob/master/module/playlist_catlist.js
// https://github.com/Binaryify/NeteaseCloudMusicApi/blob/master/module/playlist_hot.js
// https://github.com/Binaryify/NeteaseCloudMusicApi/blob/master/module/top_playlist.js
// https://github.com/Binaryify/NeteaseCloudMusicApi/blob/master/module/playlist_detail.js

import { weapi, linuxapi } from './utils/crypto'
import { httpFetch } from '../../request'
import { formatPlayTime, sizeFormate } from '../../index'
import musicDetailApi from './musicDetail'

export default {
  _requestObj_tags: null,
  _requestObj_hotTags: null,
  _requestObj_list: null,
  _requestObj_listDetail: null,
  _requestObj_listDetailLink: null,
  limit_list: 30,
  limit_song: 100000,
  successCode: 200,
  cookie: 'MUSIC_U=',
  sortList: [
    {
      name: '最热',
      id: 'hot',
    },
    // {
    //   name: '最新',
    //   id: 'new',
    // },
  ],
  regExps: {
    listDetailLink: /^.+(?:\?|&)id=(\d+)(?:&.*$|#.*$|$)/,
    listDetailLink2: /^.+\/playlist\/(\d+)\/\d+\/.+$/,
  },
  /**
   * 格式化播放数量
   * @param {*} num
   */
  formatPlayCount(num) {
    if (num > 100000000) return parseInt(num / 10000000) / 10 + '亿'
    if (num > 10000) return parseInt(num / 1000) / 10 + '万'
    return num
  },
  getSinger(singers) {
    let arr = []
    singers.forEach(singer => {
      arr.push(singer.name)
    })
    return arr.join('、')
  },

  async handleParseId(link, retryNum = 0) {
    if (this._requestObj_listDetailLink) this._requestObj_listDetailLink.cancelHttp()
    if (retryNum > 2) return Promise.reject(new Error('link try max num'))

    this._requestObj_listDetailLink = httpFetch(link)
    const { headers: { location }, statusCode } = await this._requestObj_listDetailLink.promise
    // console.log(headers)
    if (statusCode > 400) return this.handleParseId(link, ++retryNum)
    return location == null ? link : location
  },

  async getListDetail(id, page, tryNum = 0) { // 获取歌曲列表内的音乐
    if (this._requestObj_listDetail) this._requestObj_listDetail.cancelHttp()
    if (tryNum > 2) return Promise.reject(new Error('try max num'))

    if (/###/.test(id)) {
      const [url, token] = id.split('###')
      id = url
      this.cookie = `MUSIC_U=${token}`
    }
    if ((/[?&:/]/.test(id))) {
      if (this.regExps.listDetailLink.test(id)) {
        id = id.replace(this.regExps.listDetailLink, '$1')
      } else if (this.regExps.listDetailLink2.test(id)) {
        id = id.replace(this.regExps.listDetailLink2, '$1')
      } else {
        id = await this.handleParseId(id)
      }
      // console.log(id)
    }

    this._requestObj_listDetail = httpFetch('https://music.163.com/api/linux/forward', {
      method: 'post',
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36',
        Cookie: this.cookie,
      },
      form: linuxapi({
        method: 'POST',
        url: 'https://music.163.com/api/v3/playlist/detail',
        params: {
          id,
          n: this.limit_song,
          s: 8,
        },
      }),
    })
    const { statusCode, body } = await this._requestObj_listDetail.promise
    if (statusCode !== 200 || body.code !== this.successCode) return this.getListDetail(id, page, ++tryNum)
    let limit = 1000
    let rangeStart = (page - 1) * limit
    // console.log(body)
    let musicDetail
    try {
      musicDetail = await musicDetailApi.getList(body.playlist.trackIds.slice(rangeStart, limit * page).map(trackId => trackId.id))
    } catch (err) {
      console.log(err)
      if (err.message == 'try max num') {
        throw err
      } else {
        return this.getListDetail(id, page, ++tryNum)
      }
    }
    // console.log(musicDetail)
    return {
      list: musicDetail.list,
      page,
      limit,
      total: body.playlist.trackIds.length,
      source: 'wy',
      info: {
        play_count: this.formatPlayCount(body.playlist.playCount),
        name: body.playlist.name,
        img: body.playlist.coverImgUrl,
        desc: body.playlist.description,
        author: body.playlist.creator.nickname,
      },
    }
  },
  filterListDetail({ playlist: { tracks }, privileges }) {
    // console.log(tracks, privileges)
    const list = []
    tracks.forEach((item, index) => {
      const types = []
      const _types = {}
      let size
      let privilege = privileges[index]
      if (privilege.id !== item.id) privilege = privileges.find(p => p.id === item.id)
      if (!privilege) return

      switch (privilege.maxbr) {
        case 999000:
          size = null
          types.push({ type: 'flac', size })
          _types.flac = {
            size,
          }
        case 320000:
          if (item.h) {
            size = sizeFormate(item.h.size)
            types.push({ type: '320k', size })
            _types['320k'] = {
              size,
            }
          }
        case 192000:
        case 128000:
          if (item.l) {
            size = sizeFormate(item.l.size)
            types.push({ type: '128k', size })
            _types['128k'] = {
              size,
            }
          }
      }

      types.reverse()

      list.push({
        singer: this.getSinger(item.ar),
        name: item.name,
        albumName: item.al.name,
        albumId: item.al.id,
        source: 'wy',
        interval: formatPlayTime(item.dt / 1000),
        songmid: item.id,
        img: item.al.picUrl,
        lrc: null,
        otherSource: null,
        types,
        _types,
        typeUrl: {},
      })
    })
    return list
  },

  // 获取列表数据
  getList(sortId, tagId, page, tryNum = 0) {
    if (tryNum > 2) return Promise.reject(new Error('try max num'))
    if (this._requestObj_list) this._requestObj_list.cancelHttp()
    this._requestObj_list = httpFetch('https://music.163.com/weapi/playlist/list', {
      method: 'post',
      form: weapi({
        cat: tagId || '全部', // 全部,华语,欧美,日语,韩语,粤语,小语种,流行,摇滚,民谣,电子,舞曲,说唱,轻音乐,爵士,乡村,R&B/Soul,古典,民族,英伦,金属,朋克,蓝调,雷鬼,世界音乐,拉丁,另类/独立,New Age,古风,后摇,Bossa Nova,清晨,夜晚,学习,工作,午休,下午茶,地铁,驾车,运动,旅行,散步,酒吧,怀旧,清新,浪漫,性感,伤感,治愈,放松,孤独,感动,兴奋,快乐,安静,思念,影视原声,ACG,儿童,校园,游戏,70后,80后,90后,网络歌曲,KTV,经典,翻唱,吉他,钢琴,器乐,榜单,00后
        order: sortId, // hot,new
        limit: this.limit_list,
        offset: this.limit_list * (page - 1),
        total: true,
      }),
    })
    return this._requestObj_list.promise.then(({ body }) => {
      // console.log(body)
      if (body.code !== this.successCode) return this.getList(sortId, tagId, page, ++tryNum)
      return {
        list: this.filterList(body.playlists),
        total: parseInt(body.total),
        page,
        limit: this.limit_list,
        source: 'wy',
      }
    })
  },
  filterList(rawData) {
    return rawData.map(item => ({
      play_count: this.formatPlayCount(item.playCount),
      id: item.id,
      author: item.creator.nickname,
      name: item.name,
      time: item.createTime,
      img: item.coverImgUrl,
      grade: item.grade,
      desc: item.description,
      source: 'wy',
    }))
  },

  // 获取标签
  getTag(tryNum = 0) {
    if (this._requestObj_tags) this._requestObj_tags.cancelHttp()
    if (tryNum > 2) return Promise.reject(new Error('try max num'))
    this._requestObj_tags = httpFetch('https://music.163.com/weapi/playlist/catalogue', {
      method: 'post',
      form: weapi({}),
    })
    return this._requestObj_tags.promise.then(({ body }) => {
      // console.log(JSON.stringify(body))
      if (body.code !== this.successCode) return this.getTag(++tryNum)
      return this.filterTagInfo(body)
    })
  },
  filterTagInfo({ sub, categories }) {
    const subList = {}
    for (const item of sub) {
      if (!subList[item.category]) subList[item.category] = []
      subList[item.category].push({
        parent_id: categories[item.category],
        parent_name: categories[item.category],
        id: item.name,
        name: item.name,
        source: 'wy',
      })
    }

    const list = []
    for (const key of Object.keys(categories)) {
      list.push({
        name: categories[key],
        list: subList[key],
        source: 'wy',
      })
    }
    return list
  },

  // 获取热门标签
  getHotTag(tryNum = 0) {
    if (this._requestObj_hotTags) this._requestObj_hotTags.cancelHttp()
    if (tryNum > 2) return Promise.reject(new Error('try max num'))
    this._requestObj_hotTags = httpFetch('https://music.163.com/weapi/playlist/hottags', {
      method: 'post',
      form: weapi({}),
    })
    return this._requestObj_hotTags.promise.then(({ body }) => {
      // console.log(JSON.stringify(body))
      if (body.code !== this.successCode) return this.getTag(++tryNum)
      return this.filterHotTagInfo(body.tags)
    })
  },
  filterHotTagInfo(rawList) {
    return rawList.map(item => ({
      id: item.playlistTag.name,
      name: item.playlistTag.name,
      source: 'wy',
    }))
  },

  getTags() {
    return Promise.all([this.getTag(), this.getHotTag()]).then(([tags, hotTag]) => ({ tags, hotTag, source: 'wy' }))
  },

  getDetailPageUrl(id) {
    return `https://music.163.com/#/playlist?id=${id}`
  },
}

// getList
// getTags
// getListDetail
