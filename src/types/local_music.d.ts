declare namespace LX {
  namespace LocalMusic {
    interface FolderInfo {
      id: string
      name: string
      path: string
      addedAt: number
    }

    interface Config {
      folders: FolderInfo[]
      songs: LX.Music.MusicInfoLocal[]
      scannedAt: number
      sortType: 'name' | 'singer' | 'interval' | 'fileName'
      sortOrder: 'asc' | 'desc'
    }
  }
}
