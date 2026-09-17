import {theme} from 'antd';
import {TOKENS} from './palette';

const FONT_FAMILY = '"Noto Sans Georgian", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

// antd's algorithms (dark in particular) don't just derive shades FROM the
// seed colours below, they also recompute the seed colours themselves (e.g.
// dark mode picks a lighter step of the generated ramp for colorPrimary so
// it reads against a dark background) — colorPrimary/colorInfo/colorLink/
// colorSuccess/colorWarning/colorError are antd "seed" tokens, so a plain
// `token: {colorPrimary: ...}` override is silently dropped once the
// algorithm runs (antd's alias.js strips seed-token keys out of the
// override merge). Appending this as a second algorithm step is the only
// place that still runs after derivation, so it can restore the palette's
// literal values. algorithm arrays are reduced left-to-right, each step
// called as (originalSeedToken, previousStepsMapToken) — see
// @ant-design/cssinjs Theme.getDerivativeToken.
const keepPalette = (t) => (_seed, map) => ({
    ...map,
    colorPrimary: t['--if-tint'],
    colorInfo: t['--if-tint'],
    colorLink: t['--if-tint-text'],
    colorSuccess: t['--if-green-text'],
    colorWarning: t['--if-orange-text'],
    colorError: t['--if-red-text'],
});

// The ConfigProvider theme for the current mode. antd derives hover, active
// and background shades from these seeds, so they must be literal colours:
// they come from palette.js, which mirrors tokens.css.
export const antdTheme = (isDark) => {
    const t = TOKENS[isDark ? 'dark' : 'light'];
    return {
        algorithm: [isDark ? theme.darkAlgorithm : theme.defaultAlgorithm, keepPalette(t)],
        token: {
            borderRadius: 8,
            fontFamily: FONT_FAMILY,
            colorPrimary: t['--if-tint'],
            colorInfo: t['--if-tint'],
            colorLink: t['--if-tint-text'],
            colorSuccess: t['--if-green-text'],
            colorWarning: t['--if-orange-text'],
            colorError: t['--if-red-text'],
            colorSuccessText: t['--if-green-text'],
            colorWarningText: t['--if-orange-text'],
            colorErrorText: t['--if-red-text'],
            colorPrimaryHover: t['--if-tint-hover'],
            colorBorder: t['--if-border'],
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
