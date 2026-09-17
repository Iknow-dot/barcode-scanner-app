import {theme} from 'antd';
import {TOKENS} from './palette';

const FONT_FAMILY = '"Noto Sans Georgian", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

// The ConfigProvider theme for the current mode. antd derives hover, active
// and background shades from these seeds, so they must be literal colours:
// they come from palette.js, which mirrors tokens.css.
export const antdTheme = (isDark) => {
    const t = TOKENS[isDark ? 'dark' : 'light'];
    return {
        algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
            borderRadius: 8,
            fontFamily: FONT_FAMILY,
            colorPrimary: t['--if-tint'],
            colorInfo: t['--if-tint'],
            colorLink: t['--if-tint-text'],
            colorSuccess: t['--if-green-text'],
            colorWarning: t['--if-orange-text'],
            colorError: t['--if-red-text'],
            colorText: t['--if-label'],
            colorTextSecondary: t['--if-label-2'],
            colorTextTertiary: t['--if-label-3'],
            ...(isDark ? {colorBgBase: t['--if-bg-grouped']} : {}),
            colorBgLayout: t['--if-bg-grouped'],
            colorBgContainer: t['--if-bg'],
            colorBgElevated: t['--if-bg-elevated'],
            colorBorderSecondary: t['--if-sep'],
        },
        components: {
            Table: {headerBorderRadius: 10},
            Card: {borderRadiusLG: 12},
            Modal: {borderRadiusLG: 16},
            Segmented: {itemSelectedBg: t['--if-tint'], itemSelectedColor: '#ffffff'},
            Button: {primaryShadow: '0 2px 0 rgba(58, 152, 102, 0.1)'},
        },
    };
};
