import React from 'react';
import {Form, Input} from 'antd';
import {useLanguage} from '../../../../i18n/LanguageContext';

const TotalsInspector = ({block, onBlockChange}) => {
    const {t} = useLanguage();
    return (
        <Form layout="vertical" size="small">
            <Form.Item label={t.totalsLabelField}>
                <Input value={block.label} maxLength={40} onChange={e => onBlockChange({label: e.target.value})} />
            </Form.Item>
        </Form>
    );
};

export default TotalsInspector;
