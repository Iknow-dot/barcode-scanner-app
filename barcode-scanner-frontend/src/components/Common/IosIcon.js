import React from 'react';

// Glyphs from the iOS redesign canvas (.claude/ios-mockups/src/build.py), on a
// 24-unit grid in currentColor. Decorative only: every use sits next to a text
// label or inside a control with its own aria-label, so the svg is hidden from
// assistive technology. Later phases add glyphs here rather than inlining svg.
const STROKE = {
    back: <path d="m15 5-7 7 7 7"/>,
    calendar: (
        <>
            <rect x="3" y="5" width="18" height="16" rx="2.5"/>
            <path d="M3 10h18M8 3v4M16 3v4"/>
        </>
    ),
    cart: (
        <>
            <path d="M6.5 7H21l-1.6 8.2a2 2 0 0 1-2 1.6H9.2a2 2 0 0 1-2-1.6L5 3H2.5"/>
            <circle cx="9.5" cy="20.5" r="1.2"/>
            <circle cx="17.5" cy="20.5" r="1.2"/>
        </>
    ),
    check: <path d="m5 12.5 4.5 4.5L19 7"/>,
    chev: <path d="m9 5 7 7-7 7"/>,
    clock: (
        <>
            <circle cx="12" cy="12" r="9"/>
            <path d="M12 7v5l3.2 2"/>
        </>
    ),
    close: <path d="M18 6 6 18M6 6l12 12"/>,
    cloud: (
        <>
            <path d="M12 12.5v8m-3.2-3.2L12 20.5l3.2-3.2"/>
            <path d="M19.5 16.3A4.6 4.6 0 0 0 17.3 7.5h-1.2A7 7 0 1 0 4.6 15"/>
        </>
    ),
    gift: (
        <>
            <rect x="3" y="8" width="18" height="4.5" rx="1"/>
            <path d="M5 12.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7.5M12 8v13M12 8C10.5 4 6.5 3.8 6.5 6.3 6.5 8 9 8 12 8Zm0 0c1.5-4 5.5-4.2 5.5-1.7C17.5 8 15 8 12 8Z"/>
        </>
    ),
    info: (
        <>
            <circle cx="12" cy="12" r="9"/>
            <path d="M12 11v5.5M12 7.8h.01"/>
        </>
    ),
    keyboard: (
        <>
            <rect x="2" y="6" width="20" height="12" rx="2.5"/>
            <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7.5 14h9"/>
        </>
    ),
    package: (
        <>
            <path d="M21 8v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8"/>
            <path d="m3.3 7 8.7-4 8.7 4"/>
            <path d="M12 12v9"/>
            <path d="M3.3 7 12 11l8.7-4"/>
        </>
    ),
    minus: <path d="M5 12h14"/>,
    person: (
        <>
            <circle cx="12" cy="8" r="4"/>
            <path d="M4 21c1.4-3.9 4.4-6 8-6s6.6 2.1 8 6"/>
        </>
    ),
    pin: (
        <>
            <path d="M12 21.5s7-6 7-11.5a7 7 0 1 0-14 0c0 5.5 7 11.5 7 11.5Z"/>
            <circle cx="12" cy="10" r="2.5"/>
        </>
    ),
    plus: <path d="M12 5v14M5 12h14"/>,
    scan: <path d="M3 8V6a3 3 0 0 1 3-3h2M16 3h2a3 3 0 0 1 3 3v2M21 16v2a3 3 0 0 1-3 3h-2M8 21H6a3 3 0 0 1-3-3v-2M7 12h10"/>,
    search: (
        <>
            <circle cx="11" cy="11" r="7"/>
            <path d="m20 20-3.5-3.5"/>
        </>
    ),
    trash: <path d="M4 7h16M9.5 7V4.5h5V7M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>,
    warn: (
        <>
            <path d="M12 3.5 2.5 20h19L12 3.5Z"/>
            <path d="M12 10v4.5M12 17.5h.01"/>
        </>
    ),
};

const FILLED = {
    more: 'M5 10a2 2 0 1 1 0 4a2 2 0 1 1 0-4Zm7 0a2 2 0 1 1 0 4a2 2 0 1 1 0-4Zm7 0a2 2 0 1 1 0 4a2 2 0 1 1 0-4Z',
    'tab-orders': 'M6.5 2h11A2.5 2.5 0 0 1 20 4.5v15a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Zm1.5 5h8v2H8V7Zm0 4h8v2H8v-2Zm0 4h5v2H8v-2Z',
    'tab-products': 'M12 1.8 2.8 6.4v11.2L12 22.2l9.2-4.6V6.4L12 1.8Zm0 2.6 6 3-6 3-6-3 6-3Z',
};

const IosIcon = ({name, size = 24, stroke = 2}) => {
    const common = {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        'aria-hidden': 'true',
        focusable: 'false',
        className: 'if-icon',
        'data-icon': name,
    };
    if (FILLED[name]) {
        return (
            <svg {...common} fill="currentColor">
                <path fillRule="evenodd" d={FILLED[name]}/>
            </svg>
        );
    }
    if (STROKE[name]) {
        return (
            <svg
                {...common}
                fill="none"
                stroke="currentColor"
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeLinejoin="round"
            >
                {STROKE[name]}
            </svg>
        );
    }
    return null;
};

export default IosIcon;
