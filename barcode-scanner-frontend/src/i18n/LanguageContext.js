import React, {createContext, useContext, useState, useCallback, useMemo} from 'react';
import translations from './translations';

const LanguageContext = createContext();

export const LanguageProvider = ({children}) => {
    const [language, setLanguage] = useState(() => {
        return localStorage.getItem('language') || 'ka';
    });

    const switchLanguage = useCallback((lang) => {
        setLanguage(lang);
        localStorage.setItem('language', lang);
    }, []);

    const t = useMemo(() => translations[language] || translations.ka, [language]);

    const value = useMemo(() => ({
        language,
        switchLanguage,
        t,
    }), [language, switchLanguage, t]);

    return (
        <LanguageContext.Provider value={value}>
            {children}
        </LanguageContext.Provider>
    );
};

export const useLanguage = () => {
    const context = useContext(LanguageContext);
    if (!context) {
        throw new Error('useLanguage must be used within a LanguageProvider');
    }
    return context;
};

export default LanguageContext;
