import { memo, useMemo } from 'react'
import { TouchableOpacity, View } from 'react-native'
import { NAV_MENUS } from '@/config/constant'
import { setNavActiveId } from '@/core/common'
import { useI18n } from '@/lang'
import { useNavActiveId } from '@/store/common/hook'
import { useTheme } from '@/store/theme/hook'
import { Icon } from '@/components/common/Icon'
import { SvgIcon } from '@/components/common/SvgIcon'
import Text from '@/components/common/Text'
import { createStyle } from '@/utils/tools'
import { BorderWidths } from '@/theme'
import { useSettingValue } from '@/store/setting/hook'

interface TabItemProps {
  id: typeof NAV_MENUS[number]['id']
  icon: typeof NAV_MENUS[number]['icon']
}

const renderIcon = (icon: string, size: number, color: string) => {
  if (icon.startsWith('svg:')) {
    return <SvgIcon name={icon.slice(4)} size={size} color={color} />
  }
  return <Icon name={icon} size={size} color={color} />
}

const TabItem = ({ id, icon }: TabItemProps) => {
  const theme = useTheme()
  const t = useI18n()
  const activeId = useNavActiveId()
  const isActive = activeId == id
  /**
   * 切换底部导航页签。
   */
  const handlePress = () => {
    if (isActive) return
    setNavActiveId(id)
  }
  return (
    <TouchableOpacity
      style={[
        styles.item,
        isActive ? { backgroundColor: theme['c-primary-light-700-alpha-500'] } : null,
      ]}
      onPress={handlePress}
      activeOpacity={0.75}
    >
      {renderIcon(icon, 18, isActive ? theme['c-primary-font-active'] : theme['c-font-label'])}
      <Text
        style={styles.label}
        size={11}
        color={isActive ? theme['c-primary-font-active'] : theme['c-font-label']}
        numberOfLines={1}
      >
        {t(id)}
      </Text>
    </TouchableOpacity>
  )
}

export default memo(() => {
  const theme = useTheme()
  const navStatus = useSettingValue('common.navStatus')
  const navOrder = useSettingValue('common.navOrder')

  const filteredNavMenus = useMemo(() => {
    if (!navOrder) return NAV_MENUS.filter(
      menu => menu.id !== 'nav_play_history' && (menu.id === 'nav_setting' || (navStatus[menu.id] ?? true))
    )

    return navOrder
      .filter(id => id !== 'nav_play_history')
      .map(id => NAV_MENUS.find(menu => menu.id === id))
      .filter((menu): menu is typeof NAV_MENUS[number] => menu !== undefined && (menu.id === 'nav_setting' || (navStatus[menu.id] ?? true)))
  }, [navStatus, navOrder])

  return (
    <View style={[
      styles.container,
      {
        borderTopColor: theme['c-border-background'],
        backgroundColor: theme['c-content-background'],
      },
    ]}>
      {filteredNavMenus.map(item => <TabItem key={item.id} id={item.id} icon={item.icon} />)}
    </View>
  )
})

const styles = createStyle({
  container: {
    borderTopWidth: BorderWidths.normal,
    flexDirection: 'row',
    paddingHorizontal: 6,
    paddingTop: 6,
    paddingBottom: 6,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  item: {
    flex: 1,
    minHeight: 42,
    marginHorizontal: 2,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    marginTop: 2,
  },
})
