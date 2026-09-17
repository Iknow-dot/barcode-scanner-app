import React, {useEffect, useRef, useState} from 'react';
import {Input, Segmented, message} from 'antd';
import {clientService} from '../../api';
import {useLanguage} from '../../i18n/LanguageContext';
import IosIcon from '../Common/IosIcon';
import IosSheet from '../Common/IosSheet';
import ClientCreateForm from './ClientCreateForm';
import {
    LOOKUP_TABS,
    AUTO_LOOKUP_DEBOUNCE_MS,
    tabConfig,
    isSearchable,
    lookupArgs,
    clientRow,
    countLabel,
    createSeed,
} from './clientLookupView';

// Ported verbatim from ClientLookupModal.js — keep the two lists in sync
// until Task 5 removes the modal.
const ERROR_CODE_MESSAGES = {
    CLIENT_CREATE_UNVERIFIED: 'clientCreateUnverified',
    EXTERNAL_SERVICE_TIMEOUT: 'externalServiceTimeout',
    EXTERNAL_SERVICE_UNAVAILABLE: 'externalServiceUnavailable',
    EXTERNAL_SERVICE_UNAUTHORIZED: 'externalServiceUnauthorized',
    EXTERNAL_SERVICE_ERROR: 'externalServiceError',
    CLIENT_ALREADY_EXISTS: 'clientAlreadyExists',
};

// Everything the lookup step hands to the create step (task 4's
// ClientCreateForm) when the client turns out not to exist upstream, or the
// consultant jumps to create manually.
const EMPTY_SEED = {
    identification_number: '',
    phone: '',
    first_name: '',
    last_name: '',
};

export const STEP_LOOKUP = 'lookup';
export const STEP_CREATE = 'create';

/**
 * The client lookup sheet: three tabs (id / phone / name) over one search
 * field, replacing the three-stacked-fields antd Modal (ClientLookupModal).
 * Opens over the order sheet (level 1) when the consultant changes the
 * customer on an active order, or standalone when starting one.
 *
 * The create step is navbar back button, title, the not-found banner (owned
 * here, not by ClientCreateForm) and ClientCreateForm's fields. The form
 * hands us its submit function via registerSubmit so the navbar's შენახვა
 * action can trigger it.
 */
const ClientLookupSheet = ({open, onSelect, onClose, onRetail}) => {
    const {t} = useLanguage();
    const [step, setStep] = useState(STEP_LOOKUP);
    const [tab, setTab] = useState(LOOKUP_TABS[0]);
    const [value, setValue] = useState('');
    const [results, setResults] = useState([]);
    const [seed, setSeed] = useState(EMPTY_SEED);
    const [notFound, setNotFound] = useState(false);
    // ClientCreateForm hands us its submit function (registerSubmit) so the
    // navbar's შენახვა action can trigger it without the form needing to
    // know about the sheet's navbar.
    const createSubmitRef = useRef(null);
    // Mirrors ClientCreateForm's own in-flight flag (its second
    // registerSubmit argument) so the navbar save action can render itself
    // disabled/busy — a double tap must not fire two concurrent,
    // non-idempotent CreateClient calls.
    const [createBusy, setCreateBusy] = useState(false);

    useEffect(() => {
        if (open) {
            setStep(STEP_LOOKUP);
            setTab(LOOKUP_TABS[0]);
            setValue('');
            setResults([]);
            setSeed(EMPTY_SEED);
            setNotFound(false);
            createSubmitRef.current = null;
            setCreateBusy(false);
        }
    }, [open]);

    const showErrorMessage = (code, detail) => {
        const key = ERROR_CODE_MESSAGES[code];
        message.error((key && t[key]) || detail || t.clientLookupError);
    };

    // The debounce timer's callback and the name tab's submit button/Enter
    // key both land here. Guarded so a stray Enter on an unsearchable value
    // (or a submit racing a tab switch) is a silent no-op.
    const runSearch = async () => {
        if (!isSearchable(tab, value)) return;
        const args = lookupArgs(tab, value);
        const result = await clientService.checkClient(args);
        if (result.success) {
            const clients = Array.isArray(result.data?.clients) ? result.data.clients : [];
            // Preserve the typed identifier when upstream omits it, same as
            // the old modal (ClientLookupModal.js ~209-214).
            const merged = clients.map((client) => ({
                ...client,
                identification_number: client?.identification_number || args.identification_number || '',
                phone: client?.phone || args.phone || '',
            }));
            if (merged.length === 1) {
                onSelect(merged[0]);
                return;
            }
            setResults(merged);
        } else if (result.code === 'CLIENT_NOT_FOUND') {
            setSeed(createSeed(tab, value));
            setNotFound(true);
            setStep(STEP_CREATE);
        } else {
            showErrorMessage(result.code, result.error);
        }
    };

    useEffect(() => {
        // Not open: nothing should search, and closing while a timer is
        // pending must cancel it — an open=false rerender still runs this
        // effect (the sheet's own state lives above the antd Drawer that
        // unmounts its content on close), so this bail also clears the
        // previous run's pending timeout on the way out.
        if (!open) return undefined;
        if (tabConfig(tab).trigger !== 'auto') return undefined;
        if (!isSearchable(tab, value)) return undefined;
        const timer = setTimeout(() => {
            runSearch();
        }, AUTO_LOOKUP_DEBOUNCE_MS);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab, value, open]);

    const handleTabChange = (nextTab) => {
        setTab(nextTab);
        setValue('');
        setResults([]);
    };

    const handleChange = (event) => {
        setValue(event.target.value);
        setResults([]);
    };

    const handleClear = () => {
        setValue('');
        setResults([]);
    };

    const handleCreateRow = () => {
        setSeed(createSeed(tab, value));
        setNotFound(false);
        setStep(STEP_CREATE);
    };

    const config = tabConfig(tab);
    const showSearchAction = tab === 'name' && isSearchable(tab, value);

    const trailing = value ? (
        showSearchAction ? (
            <button
                type="button"
                className="if-search-trail is-action"
                aria-label={t.searchAction}
                onClick={runSearch}
            >
                <IosIcon name="search" size={18} stroke={2.6}/>
            </button>
        ) : (
            <button
                type="button"
                className="if-search-trail"
                aria-label={t.clearSearch}
                onClick={handleClear}
            >
                <IosIcon name="close" size={18} stroke={2.6}/>
            </button>
        )
    ) : null;

    const retailButton = onRetail && (
        <button type="button" className="if-btn if-btn-gray" onClick={onRetail}>
            {t.continueWithoutClient}
        </button>
    );

    const saveButton = step === STEP_CREATE && (
        <button
            type="button"
            className="if-glass-btn is-prominent is-text"
            disabled={createBusy}
            aria-busy={createBusy || undefined}
            onClick={() => createSubmitRef.current && createSubmitRef.current()}
        >
            {t.save}
        </button>
    );

    return (
        <IosSheet
            open={open}
            onClose={onClose}
            level={1}
            title={step === STEP_CREATE ? t.createCustomer : t.lookupClient}
            leading={step === STEP_CREATE ? 'back' : 'close'}
            onBack={step === STEP_CREATE ? () => setStep(STEP_LOOKUP) : undefined}
            trailing={saveButton || undefined}
            bottomBar={step === STEP_LOOKUP ? retailButton : undefined}
        >
            {step === STEP_LOOKUP ? (
                <>
                    <Segmented
                        className="if-seg"
                        block
                        value={tab}
                        onChange={handleTabChange}
                        options={LOOKUP_TABS.map((tabKey) => ({
                            label: t[tabConfig(tabKey).labelKey],
                            value: tabKey,
                        }))}
                    />
                    <div className="if-search">
                        <IosIcon name="search" size={18} stroke={2.4}/>
                        <Input
                            className="if-search-input"
                            variant="borderless"
                            value={value}
                            onChange={handleChange}
                            onPressEnter={runSearch}
                            placeholder={t[config.placeholderKey]}
                            inputMode={config.inputMode}
                            aria-label={t[config.labelKey]}
                        />
                        {trailing}
                    </div>
                    {results.length > 0 && (
                        <h4 className="if-section-header">{countLabel(results.length, t)}</h4>
                    )}
                    <div className="if-group">
                        {results.map((client, index) => {
                            const row = clientRow(client, index);
                            return (
                                <button
                                    type="button"
                                    key={row.key}
                                    className="if-row"
                                    onClick={() => onSelect(client)}
                                >
                                    <span className="if-row-main">
                                        <span className="if-row-title">{row.title}</span>
                                        {row.meta && <span className="if-row-subtitle">{row.meta}</span>}
                                        {row.address && <span className="if-row-subtitle">{row.address}</span>}
                                    </span>
                                </button>
                            );
                        })}
                        <button
                            type="button"
                            className="if-row"
                            style={{color: 'var(--if-tint-text)'}}
                            onClick={handleCreateRow}
                        >
                            <IosIcon name="plus" size={20} stroke={2.2}/>
                            <span className="if-row-main if-row-title">{t.createClientRow}</span>
                        </button>
                    </div>
                </>
            ) : (
                <>
                    {notFound && (
                        <div className="if-banner">
                            <IosIcon name="info" size={20} stroke={2.2}/>
                            <span className="if-banner-text">{t.clientNotFoundCreate}</span>
                        </div>
                    )}
                    <ClientCreateForm
                        seed={seed}
                        showNotFoundBanner={notFound}
                        onCreated={onSelect}
                        registerSubmit={(fn, busy) => {
                            createSubmitRef.current = fn;
                            setCreateBusy(!!busy);
                        }}
                    />
                </>
            )}
        </IosSheet>
    );
};

export default ClientLookupSheet;
