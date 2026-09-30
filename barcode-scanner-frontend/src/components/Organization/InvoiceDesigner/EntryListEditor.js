import React from 'react';
import {Button, Input, Switch} from 'antd';
import {ArrowDownOutlined, ArrowUpOutlined} from '@ant-design/icons';
import {useLanguage} from '../../../i18n/LanguageContext';
import {moveEntry, updateEntry} from './invoiceLayout';

/** Ordered, toggleable, renamable list — parties sections and item columns. */
const EntryListEditor = ({entries, textField, labelFor, onChange}) => {
    const {t} = useLanguage();
    return (
        <>
            {entries.map((entry, index) => (
                <div className="invoice-entry-row" key={entry.key}>
                    <Switch size="small" checked={!entry.hidden} aria-label={labelFor(entry.key)}
                            onChange={checked => onChange(updateEntry(entries, entry.key, {hidden: !checked}))} />
                    <Input size="small" value={entry[textField]} maxLength={40} placeholder={labelFor(entry.key)}
                           onChange={e => onChange(updateEntry(entries, entry.key, {[textField]: e.target.value}))} />
                    <Button size="small" type="text" aria-label={t.moveUp} icon={<ArrowUpOutlined />} disabled={index === 0}
                            onClick={() => onChange(moveEntry(entries, entry.key, -1))} />
                    <Button size="small" type="text" aria-label={t.moveDown} icon={<ArrowDownOutlined />}
                            disabled={index === entries.length - 1}
                            onClick={() => onChange(moveEntry(entries, entry.key, 1))} />
                </div>
            ))}
        </>
    );
};

export default EntryListEditor;
