import React from 'react';
import {QrcodeOutlined} from "@ant-design/icons";
import {Button} from "antd";
import {useLanguage} from '../../i18n/LanguageContext';
import "./ScanButton.css";

const ScanButton = ({onPress, disabled}) => {
    const {t} = useLanguage();

    return (
        <Button
            type="primary"
            size="large"
            onClick={onPress}
            disabled={disabled}
            className="scan-fab"
            icon={<QrcodeOutlined style={{fontSize: 20}}/>}
        >
            {t.scan}
        </Button>
    );
};

export default ScanButton;
