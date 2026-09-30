import React from 'react';
import {Button, Input, Switch} from 'antd';
import {ArrowDownOutlined, ArrowUpOutlined} from '@ant-design/icons';
import {useLanguage} from '../../../i18n/LanguageContext';
import {moveEntry, updateEntry} from './invoiceLayout';

/**
 * Ordered, toggleable, renamable list — parties sections and item columns.
 * `requireOneVisible` (set by `ItemsInspector` only — the backend rejects an
 * items table with every column hidden; parties sections may all be hidden)
 * disables the switch of the last remaining visible entry.
 */
const EntryListEditor = ({entries, textField, labelFor, onChange, requireOneVisible = false}) => {
    const {t} = useLanguage();
    const visibleCount = entries.filter(e => !e.hidden).length;
    return (
        <>
            {entries.map((entry, index) => (
                <div className="invoice-entry-row" key={entry.key}>
                    <Switch size="small" checked={!entry.hidden} aria-label={labelFor(entry.key)}
                            disabled={requireOneVisible && !entry.hidden && visibleCount <= 1}
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
