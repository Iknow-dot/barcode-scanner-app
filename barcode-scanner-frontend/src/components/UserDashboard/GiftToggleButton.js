import React from 'react';
import {Button} from 'antd';
import {GiftOutlined} from '@ant-design/icons';

// Per-line gift toggle (ClickUp 86ca495uu). Rendered only when the org has
// gift marking enabled; the backend independently enforces GIFT_NOT_ENABLED.
const GiftToggleButton = ({enabled, isGift, onToggle, label}) => {
    if (!enabled) return null;
    return (
        <Button
            type="text"
            size="small"
            icon={<GiftOutlined/>}
            onClick={onToggle}
            aria-label={label}
            title={label}
            style={{color: isGift ? '#eb2f96' : undefined}}
        />
    );
};

export default GiftToggleButton;
