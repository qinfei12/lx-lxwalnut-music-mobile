import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  FlatList,
  RefreshControl,
  ScrollView,
  TouchableOpacity,
  View,
  type ListRenderItem,
} from 'react-native'
import Text from '@/components/common/Text'
import Button from '@/components/common/Button'
import Image from '@/components/common/Image'
import { Icon } from '@/components/common/Icon'
import { SvgIcon } from '@/components/common/SvgIcon'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { confirmDialog, createStyle, toast, requestStoragePermission } from '@/utils/tools'
import { LIST_IDS, LIST_ITEM_HEIGHT } from '@/config/constant'
import { scaleSizeH } from '@/utils/pixelRatio'
import { overwriteListMusics } from '@/core/list'
import { playList } from '@/core/player/player'
import { addTempPlayList } from '@/core/player/tempPlayList'
import { usePlayMusicInfo } from '@/store/player/hook'
import {
  getConfig,
  addFolder,
  removeFolder,
  refreshList,
  fullDeviceScan,
  clearList,
  setSort,
  getTotalSize,
  formatSize,
} from '@/core/localMusic'
import { readMetadata, readPic } from '@/utils/localMediaMetadata'
import { selectManagedFolder } from '@/utils/fs'
import DorpDownMenu from '@/components/common/DorpDownMenu'
import { useSettingValue } from '@/store/setting/hook'

const ITEM_HEIGHT = scaleSizeH(LIST_ITEM_HEIGHT)

type SortType = LX.LocalMusic.Config['sortType']
type SortOrder = LX.LocalMusic.Config['sortOrder']

const SongItem = memo(
  ({
    item,
    index,
    isPlaying,
    onPress,
    onShowMenu,
  }: {
    item: LX.Music.MusicInfoLocal
    index: number
    isPlaying: boolean
    onPress: (musicInfo: LX.Music.MusicInfoLocal) => void
    onShowMenu: (
      item: LX.Music.MusicInfoLocal,
      index: number,
      position: { x: number; y: number; w: number; h: number }
    ) => void
  }) => {
    const theme = useTheme()
    const moreButtonRef = useRef<TouchableOpacity>(null)
    const subText = item.singer || item.meta.filePath.split(/\/|\\/).pop() || ''

    const handleShowMenu = () => {
      if (moreButtonRef.current?.measure) {
        moreButtonRef.current.measure((fx, fy, width, height, px, py) => {
          onShowMenu(item, index, {
            x: Math.ceil(px),
            y: Math.ceil(py),
            w: Math.ceil(width),
            h: Math.ceil(height),
          })
        })
      }
    }

    return (
      <View
        style={{
          ...styles.songItem,
          backgroundColor: isPlaying ? theme['c-primary-background-hover'] : 'transparent',
        }}
      >
        <TouchableOpacity style={styles.songItemLeft} onPress={() => onPress(item)}>
          <View style={styles.sn}>
            {item.meta.picUrl ? (
              <Image url={item.meta.picUrl} style={styles.albumArt} cache={false} />
            ) : (
              <View style={styles.albumArtPlaceholder}>
                <Icon name="music" size={20} color={theme['c-font-label']} />
              </View>
            )}
          </View>
          <View style={styles.itemInfo}>
            <Text color={isPlaying ? theme['c-primary-font'] : theme['c-font']} numberOfLines={1}>
              {item.name || item.meta.filePath.split(/\/|\\/).pop() || ''}
            </Text>
            <View style={styles.listItemSingle}>
              <Text
                style={styles.listItemSingleText}
                size={11}
                color={isPlaying ? theme['c-primary-alpha-200'] : theme['c-500']}
                numberOfLines={1}
              >
                {subText}
              </Text>
            </View>
            {item.interval ? (
              <Text size={10} color={isPlaying ? theme['c-primary-alpha-200'] : theme['c-500']} numberOfLines={1}>
                {item.interval}
              </Text>
            ) : null}
          </View>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleShowMenu} ref={moreButtonRef} style={styles.moreButton}>
          <Icon name="dots-vertical" style={{ color: theme['c-350'] }} size={12} />
        </TouchableOpacity>
      </View>
    )
  }
)

export default memo(() => {
  const theme = useTheme()
  const t = useI18n()
  const playMusicInfo = usePlayMusicInfo()
  const [loading, setLoading] = useState(false)
  const [songs, setSongs] = useState<LX.Music.MusicInfoLocal[]>([])
  const [folders, setFolders] = useState<LX.LocalMusic.FolderInfo[]>([])
  const [sortType, setSortTypeState] = useState<SortType>('fileName')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')
  const [scannedAt, setScannedAt] = useState<number>(0)
  const [totalSize, setTotalSize] = useState<number>(0)
  const [showFolderManager, setShowFolderManager] = useState(false)
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [showActionMenu, setShowActionMenu] = useState(false)
  const [selectedMusic, setSelectedMusic] = useState<{
    musicInfo: LX.Music.MusicInfoLocal
    index: number
    position: { x: number; y: number; w: number; h: number }
  } | null>(null)
  const [scanText, setScanText] = useState('')
  const isShowCover = useSettingValue('list.isShowCover')
  const listRef = useRef<FlatList<LX.Music.MusicInfoLocal>>(null)

  const loadConfig = useCallback(() => {
    void getConfig().then(config => {
      setSongs(config.songs ?? [])
      setFolders(config.folders ?? [])
      setSortTypeState(config.sortType)
      setSortOrder(config.sortOrder)
      setScannedAt(config.scannedAt ?? 0)
      void getTotalSize(config.songs ?? []).then(setTotalSize)
    })
  }, [])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  const syncSongsCover = useCallback(async (songList: LX.Music.MusicInfoLocal[]) => {
    const updatedSongs = await Promise.all(
      songList.map(async (song) => {
        try {
          const picUrl = await readPic(song.meta.filePath).catch(() => null)
          if (picUrl) {
            const newPicUrl = picUrl.startsWith('/') ? `file://${picUrl}` : picUrl
            if (newPicUrl !== song.meta.picUrl) {
              return {
                ...song,
                meta: {
                  ...song.meta,
                  picUrl: newPicUrl,
                },
              }
            }
          }
        } catch {
          // ignore
        }
        return song
      })
    )
    setSongs(updatedSongs)
  }, [])

  const handlePlay = useCallback(
    (musicInfo: LX.Music.MusicInfoLocal) => {
      const index = songs.findIndex(item => item.id === musicInfo.id)
      if (index < 0) return
      setLoading(true)
      void overwriteListMusics(LIST_IDS.TEMP, songs).then(() => {
        void playList(LIST_IDS.TEMP, index).finally(() => {
          setLoading(false)
          void syncSongsCover(songs)
        })
      })
    },
    [songs, syncSongsCover]
  )

  const handlePlayLater = useCallback((musicInfo: LX.Music.MusicInfoLocal) => {
    addTempPlayList([{
      listId: null,
      musicInfo,
    }])
    toast(t('play_later_add'))
  }, [t])

  const handleShowMenu = useCallback(
    (
      musicInfo: LX.Music.MusicInfoLocal,
      index: number,
      position: { x: number; y: number; w: number; h: number }
    ) => {
      setSelectedMusic({ musicInfo, index, position })
      setShowActionMenu(true)
    },
    []
  )

  const handleAddFolder = useCallback(async () => {
    try {
      const hasPermission = await requestStoragePermission()
      if (!hasPermission) return

      const result = await selectManagedFolder(true)
      if (result.isDirectory) {
        setLoading(true)
        setScanText('')
        const config = await addFolder(result.path)
        setFolders(config.folders)
        const updated = await refreshList((count) => {
          setScanText(t('searching', { count }))
        })
        setSongs(updated.songs)
        setScannedAt(updated.scannedAt)
        void getTotalSize(updated.songs).then(setTotalSize)
        void syncSongsCover(updated.songs)
        setLoading(false)
        setScanText('')
        toast(t('list_scan_complete'))
      }
    } catch (err) {
      setLoading(false)
      setScanText('')
      toast(String(err))
    }
  }, [syncSongsCover, t])

  const handleRemoveFolder = useCallback((folderId: string) => {
    void confirmDialog({
      message: t('list_remove_tip'),
      confirmButtonText: t('list_remove_tip_button'),
    }).then(async (isRemove) => {
      if (!isRemove) return
      setLoading(true)
      const config = await removeFolder(folderId)
      setFolders(config.folders)
      setSongs(config.songs)
      setScannedAt(config.scannedAt)
      void getTotalSize(config.songs).then(setTotalSize)
      setLoading(false)
    })
  }, [t])

  const handleRefresh = useCallback(() => {
    if (folders.length === 0) {
      toast(t('no_folder_tip'))
      return
    }
    setLoading(true)
    setScanText('')
    void refreshList((count) => {
      setScanText(t('searching', { count }))
    }).then(config => {
      setSongs(config.songs)
      setScannedAt(config.scannedAt)
      void getTotalSize(config.songs).then(setTotalSize)
      void syncSongsCover(config.songs)
      setLoading(false)
      setScanText('')
      toast(t('list_scan_complete'))
    }).catch(err => {
      setLoading(false)
      setScanText('')
      toast(String(err))
    })
  }, [folders.length, syncSongsCover, t])

  const handleFullScan = useCallback(() => {
    void confirmDialog({
      message: t('full_scan_tip'),
      confirmButtonText: t('confirm'),
    }).then(async (isConfirm) => {
      if (!isConfirm) return
      const hasPermission = await requestStoragePermission()
      if (!hasPermission) return
      setLoading(true)
      setScanText('')
      void fullDeviceScan((count) => {
        setScanText(t('searching', { count }))
      }).then(config => {
        setSongs(config.songs)
        setScannedAt(config.scannedAt)
        void getTotalSize(config.songs).then(setTotalSize)
        void syncSongsCover(config.songs)
        setLoading(false)
        setScanText('')
        toast(t('list_scan_complete'))
      }).catch(err => {
        setLoading(false)
        setScanText('')
        toast(String(err))
      })
    })
  }, [syncSongsCover, t])

  const handleClearList = useCallback(() => {
    void confirmDialog({
      message: t('list_clear_tip'),
      confirmButtonText: t('list_remove_tip_button'),
    }).then(async (isClear) => {
      if (!isClear) return
      setLoading(true)
      const config = await clearList()
      setSongs(config.songs)
      setScannedAt(config.scannedAt)
      setTotalSize(0)
      setLoading(false)
    })
  }, [t])

  const handleChangeSort = useCallback((type: SortType) => {
    setShowSortMenu(false)
    const newOrder = sortType === type && sortOrder === 'asc' ? 'desc' : 'asc'
    setSortTypeState(type)
    setSortOrder(newOrder)
    void setSort(type, newOrder).then(config => {
      setSongs([...config.songs])
    })
  }, [sortType, sortOrder])

  const actionMenus = useMemo(() => {
    const list: Array<{ id: string; name: string }> = [
      { id: 'play', name: t('play_now') },
      { id: 'playLater', name: t('play_later') },
      { id: 'copyName', name: t('copy_name') },
    ]
    return list
  }, [t])

  const handleActionPress = useCallback((action: string) => {
    setShowActionMenu(false)
    if (!selectedMusic) return
    const { musicInfo } = selectedMusic
    switch (action) {
      case 'play':
        handlePlay(musicInfo)
        break
      case 'playLater':
        handlePlayLater(musicInfo)
        break
      case 'copyName':
        toast(t('copy_success'))
        break
    }
  }, [selectedMusic, handlePlay, handlePlayLater, t])

  const sortMenus = useMemo(() => ([
    { id: 'fileName' as SortType, name: t('sort_by_filename') },
    { id: 'name' as SortType, name: t('sort_by_name') },
    { id: 'singer' as SortType, name: t('sort_by_singer') },
    { id: 'interval' as SortType, name: t('sort_by_duration') },
  ]), [t])

  const renderItem: ListRenderItem<LX.Music.MusicInfoLocal> = useCallback(
    ({ item, index }) => (
      <SongItem
        item={item}
        index={index}
        isPlaying={playMusicInfo.musicInfo?.id === item.id}
        onPress={handlePlay}
        onShowMenu={handleShowMenu}
      />
    ),
    [playMusicInfo.musicInfo?.id, handlePlay, handleShowMenu]
  )

  const keyExtractor = useCallback((item: LX.Music.MusicInfoLocal) => item.id, [])

  const ListHeader = useMemo(() => (
    <View style={styles.headerContainer}>
      <Text size={20} style={styles.title} color={theme['c-font']}>
        {t('nav_local')}
      </Text>
      <View style={styles.actionRow}>
        <Button
          style={[styles.actionBtn, { backgroundColor: theme['c-button-background'] }]}
          textStyle={styles.actionBtnText}
          onPress={handleAddFolder}
        >
          <SvgIcon name="folder-plus" size={14} color={theme['c-primary-font']} />
          <Text size={13} color={theme['c-primary-font']}>{t('add_folder')}</Text>
        </Button>
        <Button
          style={[styles.actionBtn, { backgroundColor: theme['c-button-background'] }]}
          textStyle={styles.actionBtnText}
          onPress={() => setShowFolderManager(true)}
        >
          <Icon name="menu" size={14} color={theme['c-primary-font']} />
          <Text size={13} color={theme['c-primary-font']}>{t('folder_manager')}</Text>
        </Button>
      </View>
      <View style={styles.actionRow}>
        <Button
          style={[styles.actionBtn, { backgroundColor: theme['c-button-background'] }]}
          textStyle={styles.actionBtnText}
          onPress={handleRefresh}
        >
          <SvgIcon name="refresh" size={14} color={theme['c-primary-font']} />
          <Text size={13} color={theme['c-primary-font']}>{t('refresh_list')}</Text>
        </Button>
        <Button
          style={[styles.actionBtn, { backgroundColor: theme['c-button-background'] }]}
          textStyle={styles.actionBtnText}
          onPress={() => setShowSortMenu(true)}
        >
          <SvgIcon name="sort" size={14} color={theme['c-primary-font']} />
          <Text size={13} color={theme['c-primary-font']}>{t('sort')}</Text>
        </Button>
        <Button
          style={[styles.actionBtn, { backgroundColor: theme['c-button-background'] }]}
          textStyle={styles.actionBtnText}
          onPress={handleFullScan}
        >
          <Icon name="search-2" size={14} color={theme['c-primary-font']} />
          <Text size={13} color={theme['c-primary-font']}>{t('full_scan')}</Text>
        </Button>
      </View>
      <View style={styles.actionRow}>
        <Button
          style={[styles.actionBtn, styles.clearBtn, { backgroundColor: theme['c-button-background'] }]}
          textStyle={styles.actionBtnText}
          onPress={handleClearList}
        >
          <Icon name="close" size={14} color={theme['c-primary-font']} />
          <Text size={13} color={theme['c-primary-font']}>{t('clear_list')}</Text>
        </Button>
      </View>
      <View style={styles.statsRow}>
        <Text size={12} color={theme['c-font-label']}>
          {t('list_total', { count: songs.length })}  {formatSize(totalSize)}
        </Text>
      </View>
      {scanText ? (
        <View style={[styles.scanProgress, { backgroundColor: theme['c-primary-background-hover'] }]}>
          <Text size={12} color={theme['c-primary-font']}>{scanText}</Text>
        </View>
      ) : null}
    </View>
  ), [theme, t, songs.length, totalSize, scanText, handleAddFolder, handleRefresh, handleFullScan, handleClearList])

  return (
    <View style={[styles.container, { backgroundColor: theme['c-content-background'] }]}>
      <FlatList
        ref={listRef}
        data={songs}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        getItemLayout={(_, index) => ({
          length: ITEM_HEIGHT,
          offset: ITEM_HEIGHT * index,
          index,
        })}
        ListHeaderComponent={ListHeader}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={handleRefresh}
            tintColor={theme['c-primary-font']}
          />
        }
        contentContainerStyle={songs.length === 0 ? styles.emptyContent : null}
      />

      {songs.length === 0 && !loading ? (
        <View style={styles.emptyView}>
          <SvgIcon name="folder" rawSize={60} color={theme['c-font-label']} />
          <Text style={styles.emptyText} color={theme['c-font-label']}>
            {t('no_item')}
          </Text>
          <Button
            style={[styles.emptyBtn, { backgroundColor: theme['c-button-background'] }]}
            onPress={handleAddFolder}
          >
            <Text color={theme['c-primary-font']}>{t('add_folder_first')}</Text>
          </Button>
        </View>
      ) : null}

      {showSortMenu ? (
        <DorpDownMenu
          title={t('sort_title')}
          menus={sortMenus.map(m => ({ ...m, check: sortType === m.id }))}
          onPress={(id) => handleChangeSort(id as SortType)}
          onClose={() => setShowSortMenu(false)}
        />
      ) : null}

      {showActionMenu && selectedMusic ? (
        <DorpDownMenu
          title={selectedMusic.musicInfo.name}
          menus={actionMenus}
          onPress={handleActionPress}
          onClose={() => setShowActionMenu(false)}
          position={selectedMusic.position}
        />
      ) : null}

      {showFolderManager ? (
        <DorpDownMenu
          title={t('folder_manager')}
          menus={[
            ...folders.map(f => ({ id: f.id, name: f.name })),
            { id: '__add__', name: `+ ${t('add_folder')}` },
          ]}
          onPress={(id) => {
            if (id === '__add__') {
              setShowFolderManager(false)
              handleAddFolder()
            } else {
              handleRemoveFolder(id as string)
              setShowFolderManager(false)
            }
          }}
          onClose={() => setShowFolderManager(false)}
        />
      ) : null}
    </View>
  )
})

const styles = createStyle({
  container: {
    flex: 1,
  },
  headerContainer: {
    paddingHorizontal: 15,
    paddingTop: 15,
    paddingBottom: 10,
  },
  title: {
    fontWeight: 'bold',
    marginBottom: 12,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  actionBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginRight: 10,
    marginBottom: 8,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionBtnText: {
    marginLeft: 6,
    fontWeight: '500',
  },
  clearBtn: {},
  statsRow: {
    marginTop: 6,
    marginBottom: 4,
  },
  scanProgress: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  songItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
    height: ITEM_HEIGHT,
  },
  songItemLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  albumArt: {
    width: 40,
    height: 40,
    borderRadius: 4,
  },
  albumArtPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(128, 128, 128, 0.1)',
  },
  itemInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  listItemSingle: {
    marginTop: 4,
  },
  listItemSingleText: {},
  moreButton: {
    padding: 10,
  },
  emptyContent: {
    flexGrow: 1,
  },
  emptyView: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    marginTop: 15,
    marginBottom: 20,
    fontSize: 14,
  },
  emptyBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
})
