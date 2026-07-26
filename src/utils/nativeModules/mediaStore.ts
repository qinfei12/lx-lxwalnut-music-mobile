import { NativeModules } from 'react-native'

const { MediaStoreModule } = NativeModules

export interface MediaStoreAudioItem {
  id: string
  filePath: string
  contentUri: string
  fileName: string
  title: string
  artist: string
  album: string
  duration: number // 秒
  mimeType: string
  size: number
  dateAdded: number
}

export const getAllAudioFiles = async (): Promise<MediaStoreAudioItem[]> => {
  return MediaStoreModule.getAllAudioFiles() as Promise<MediaStoreAudioItem[]>
}

export const checkAudioPermission = async (): Promise<boolean> => {
  return MediaStoreModule.checkAudioPermission() as Promise<boolean>
}
