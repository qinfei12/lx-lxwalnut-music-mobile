import { getData, saveData } from '@/plugins/storage'
import { readMetadata } from '@/utils/localMediaMetadata'
import { readDir, stat, extname, externalStorageDirectoryPath, getExternalStoragePaths } from '@/utils/fs'
import { getAllAudioFiles } from '@/utils/nativeModules/mediaStore'
import { storageDataPrefix } from '@/config/constant'
import { toast } from '@/utils/tools'

const CONFIG_KEY = storageDataPrefix.setting + '_local_music'

const AUDIO_EXTENSIONS = new Set([
  'mp3',
  'flac',
  'wav',
  'm4a',
  'aac',
  'ogg',
  'oga',
  'opus',
  'wma',
  'ape',
])

const isAudioFile = (file: { name?: string; mimeType?: string }): boolean => {
  if (file.mimeType?.startsWith('audio/')) return true
  const ext = extname(file.name ?? '').toLowerCase()
  return AUDIO_EXTENSIONS.has(ext)
}

const parseFileName = (fileName: string): { name: string; singer: string } => {
  const dotIndex = fileName.lastIndexOf('.')
  const rawName = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName
  if (!rawName.includes('-')) return { name: rawName.trim(), singer: '' }
  const [left, ...rest] = rawName.split('-')
  return {
    name: rest.join('-').trim(),
    singer: left.trim(),
  }
}

const buildId = (filePath: string): string => {
  return `local__${filePath}`
}

const safToRealPath = (safEncodedPath: string): string => {
  if (!safEncodedPath) return ''
  if (safEncodedPath.startsWith('/storage/')) return safEncodedPath

  let decoded = safEncodedPath
  try {
    decoded = decodeURIComponent(safEncodedPath)
  } catch {}

  const primaryIndex = decoded.lastIndexOf('primary:')
  if (primaryIndex >= 0) {
    const relativePath = decoded.substring(primaryIndex + 8)
    return `/storage/emulated/0/${relativePath}`
  }

  const treeMatch = decoded.match(/tree\/([^:]+):(.+)/)
  if (treeMatch) {
    const volume = treeMatch[1]
    const relativePath = treeMatch[2]
    if (volume === 'primary') {
      return `/storage/emulated/0/${relativePath}`
    }
    return `/storage/${volume}/${relativePath}`
  }

  const documentMatch = decoded.match(/document\/([^:]+):(.+)/)
  if (documentMatch) {
    const volume = documentMatch[1]
    const relativePath = documentMatch[2]
    if (volume === 'primary') {
      return `/storage/emulated/0/${relativePath}`
    }
    return `/storage/${volume}/${relativePath}`
  }

  return decoded
}

const getDefaultConfig = (): LX.LocalMusic.Config => ({
  folders: [],
  songs: [],
  scannedAt: 0,
  sortType: 'fileName',
  sortOrder: 'asc',
})

export const getConfig = async (): Promise<LX.LocalMusic.Config> => {
  try {
    const config = await getData<LX.LocalMusic.Config>(CONFIG_KEY)
    if (config) return config
  } catch {}
  return getDefaultConfig()
}

export const saveConfig = async (config: LX.LocalMusic.Config): Promise<void> => {
  await saveData(CONFIG_KEY, config)
}

const scanDirectory = async (
  dirPath: string,
  onProgress?: (count: number) => void,
  shouldStop?: () => boolean
): Promise<LX.Music.MusicInfoLocal[]> => {
  const results: LX.Music.MusicInfoLocal[] = []
  const stack: string[] = [dirPath]
  const visited = new Set<string>()

  while (stack.length > 0) {
    if (shouldStop?.()) return results

    const currentPath = stack.pop()!
    if (visited.has(currentPath)) continue
    visited.add(currentPath)

    let entries: Array<{ name?: string; path?: string; type?: string; size?: number; mimeType?: string }>

    try {
      entries = await readDir(currentPath)
    } catch {
      continue
    }

    for (const entry of entries) {
      if (shouldStop?.()) return results

      const rawEntryPath = entry.path ?? `${currentPath}/${entry.name ?? ''}`
      const entryPath = safToRealPath(rawEntryPath)
      const entryName = entry.name ?? ''

      if (entry.type === 'directory') {
        if (!visited.has(entryPath)) {
          stack.push(entryPath)
        }
      } else if (isAudioFile(entry)) {
        try {
          const metadata = await readMetadata(entryPath).catch(() => null)
          const { name: parsedName, singer: parsedSinger } = parseFileName(entryName)
          const name = metadata?.name || parsedName
          const singer = metadata?.artist || parsedSinger
          const albumName = metadata?.album || ''

          const musicInfo: LX.Music.MusicInfoLocal = {
            id: buildId(entryPath),
            name,
            singer,
            source: 'local',
            interval: metadata?.duration ? formatDuration(metadata.duration) : null,
            meta: {
              songId: entryPath,
              albumName,
              filePath: entryPath,
              ext: extname(entryName).toLowerCase(),
            },
          }
          results.push(musicInfo)
          if (onProgress) onProgress(results.length)
        } catch {
          // skip unreadable files
        }
      }
    }
  }

  return results
}

const formatDuration = (seconds: number): string => {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export const addFolder = async (folderPath: string): Promise<LX.LocalMusic.Config> => {
  const config = await getConfig()
  const realPath = safToRealPath(folderPath)
  if (config.folders.some(f => f.path === realPath)) {
    toast(global.i18n.t('open_storage_path_tip'))
    return config
  }

  const newFolder: LX.LocalMusic.FolderInfo = {
    id: `folder_${Date.now()}`,
    name: realPath,
    path: realPath,
    addedAt: Date.now(),
  }

  config.folders.push(newFolder)
  await saveConfig(config)
  return config
}

export const removeFolder = async (folderId: string): Promise<LX.LocalMusic.Config> => {
  const config = await getConfig()
  const folder = config.folders.find(f => f.id === folderId)
  if (!folder) return config

  config.folders = config.folders.filter(f => f.id !== folderId)
  config.songs = config.songs.filter(s => !s.meta.filePath.startsWith(folder.path))
  config.scannedAt = Date.now()
  await saveConfig(config)
  return config
}

export const scanAllFolders = async (
  onProgress?: (count: number) => void
): Promise<LX.LocalMusic.Config> => {
  const config = await getConfig()
  const folderSongs: LX.Music.MusicInfoLocal[] = []
  const seenPaths = new Set<string>()

  for (const folder of config.folders) {
    const songs = await scanDirectory(folder.path, (count) => {
      if (onProgress) onProgress(folderSongs.length + count)
    })
    for (const song of songs) {
      if (!seenPaths.has(song.meta.filePath)) {
        seenPaths.add(song.meta.filePath)
        folderSongs.push(song)
      }
    }
  }

  const folderPaths = new Set(folderSongs.map(s => s.meta.filePath))
  const nonFolderSongs = config.songs.filter(s => !folderPaths.has(s.meta.filePath))

  config.songs = [...folderSongs, ...nonFolderSongs]
  config.scannedAt = Date.now()
  sortSongs(config)
  await saveConfig(config)
  return config
}

export const fullDeviceScan = async (
  onProgress?: (count: number) => void
): Promise<LX.LocalMusic.Config> => {
  const config = await getConfig()
  const allSongs: LX.Music.MusicInfoLocal[] = []
  const seenPaths = new Set<string>()

  try {
    const audioFiles = await getAllAudioFiles()
    let processedCount = 0

    for (const audio of audioFiles) {
      const filePath = audio.filePath || audio.contentUri
      if (!filePath || seenPaths.has(filePath)) continue
      seenPaths.add(filePath)

      const entryName = audio.fileName || filePath.split(/\/|\\/).pop() || ''
      const { name: parsedName, singer: parsedSinger } = parseFileName(entryName)

      const musicInfo: LX.Music.MusicInfoLocal = {
        id: buildId(filePath),
        name: audio.title || parsedName,
        singer: audio.artist || parsedSinger,
        source: 'local',
        interval: audio.duration > 0 ? formatDuration(audio.duration) : null,
        meta: {
          songId: filePath,
          albumName: audio.album || '',
          filePath,
          ext: extname(entryName).toLowerCase(),
        },
      }
      allSongs.push(musicInfo)
      processedCount++
      if (onProgress && processedCount % 10 === 0) onProgress(processedCount)
    }

    if (onProgress) onProgress(allSongs.length)
  } catch (err) {
    console.warn('MediaStore scan failed, falling back to directory scan:', err)
    const fallbackPaths = ['/storage/emulated/0/Music', '/storage/emulated/0/Download']
    for (const path of fallbackPaths) {
      try {
        const songs = await scanDirectory(path, (count) => {
          if (onProgress) onProgress(allSongs.length + count)
        })
        for (const song of songs) {
          if (!seenPaths.has(song.meta.filePath)) {
            seenPaths.add(song.meta.filePath)
            allSongs.push(song)
          }
        }
      } catch {}
    }
  }

  if (allSongs.length > 0) {
    config.songs = allSongs
    config.scannedAt = Date.now()
    sortSongs(config)
    await saveConfig(config)
  }

  return config
}

export const refreshList = async (
  onProgress?: (count: number) => void
): Promise<LX.LocalMusic.Config> => {
  return scanAllFolders(onProgress)
}

export const clearList = async (): Promise<LX.LocalMusic.Config> => {
  const config = await getConfig()
  config.songs = []
  config.scannedAt = 0
  await saveConfig(config)
  return config
}

const sortSongs = (config: LX.LocalMusic.Config): void => {
  const { sortType, sortOrder } = config
  config.songs.sort((a, b) => {
    let comparison = 0
    switch (sortType) {
      case 'name':
        comparison = a.name.localeCompare(b.name, 'zh-CN')
        break
      case 'singer':
        comparison = a.singer.localeCompare(b.singer, 'zh-CN')
        break
      case 'interval': {
        const aSec = parseInterval(a.interval)
        const bSec = parseInterval(b.interval)
        comparison = aSec - bSec
        break
      }
      case 'fileName':
      default: {
        const aName = a.meta.filePath.split(/\/|\\/).pop() || ''
        const bName = b.meta.filePath.split(/\/|\\/).pop() || ''
        comparison = aName.localeCompare(bName, 'zh-CN')
        break
      }
    }
    return sortOrder === 'desc' ? -comparison : comparison
  })
}

const parseInterval = (interval: string | null): number => {
  if (!interval) return 0
  const parts = interval.split(':')
  if (parts.length === 2) {
    return parseInt(parts[0]) * 60 + parseInt(parts[1])
  }
  return 0
}

export const setSort = (
  sortType: LX.LocalMusic.Config['sortType'],
  sortOrder: LX.LocalMusic.Config['sortOrder']
): Promise<LX.LocalMusic.Config> => {
  return getConfig().then(config => {
    config.sortType = sortType
    config.sortOrder = sortOrder
    sortSongs(config)
    return saveConfig(config).then(() => config)
  })
}

export const getTotalSize = (songs: LX.Music.MusicInfoLocal[]): Promise<number> => {
  return Promise.all(
    songs.map(song =>
      stat(song.meta.filePath)
        .then(s => s.size ?? 0)
        .catch(() => 0)
    )
  ).then(sizes => sizes.reduce((sum, size) => sum + size, 0))
}

export const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
