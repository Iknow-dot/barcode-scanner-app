import React from 'react';
import {Dropdown} from 'antd';
import {LogoutOutlined, MoonOutlined, SunOutlined} from '@ant-design/icons';
import {useLanguage} from '../../i18n/LanguageContext';
import IosIcon from '../Common/IosIcon';

// Home's round glass account button. Its menu holds what the antd Header gave
// /dashboard before the consultant shell dropped it: the username, language,
// light/dark mode and logout.
const AccountMenuButton = ({username = '', isDark = false, onToggleTheme, onLogout}) => {
    const {language, switchLanguage, t} = useLanguage();
    const checkFor = (lang) => (language === lang ? <IosIcon name="check" size={16} stroke={2.6}/> : null);
    const items = [
        {key: 'user', label: username, disabled: true},
        {type: 'divider'},
        {
            key: 'language',
            type: 'group',
            label: t.language,
            children: [
                {key: 'lang-ka', label: t.georgian, extra: checkFor('ka'), onClick: () => switchLanguage('ka')},
                {key: 'lang-en', label: t.english, extra: checkFor('en'), onClick: () => switchLanguage('en')},
            ],
        },
        {type: 'divider'},
        {
            key: 'theme',
            icon: isDark ? <SunOutlined/> : <MoonOutlined/>,
            label: isDark ? t.lightMode : t.darkMode,
            onClick: () => onToggleTheme(),
        },
        {type: 'divider'},
        {
            key: 'logout',
            icon: <LogoutOutlined/>,
            label: t.logout,
            danger: true,
            onClick: () => onLogout(),
        },
    ];
    return (
        <Dropdown menu={{items}} trigger={['click']} placement="bottomRight">
            <button type="button" className="if-glass-btn is-tint-text" aria-label={t.accountMenu}>
                {(username || '?').charAt(0).toUpperCase()}
            </button>
        </Dropdown>
    );
};

export default AccountMenuButton;
