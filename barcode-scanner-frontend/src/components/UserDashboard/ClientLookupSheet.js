import React, {useEffect, useRef, useState} from 'react';
import {Input, Segmented, message} from 'antd';
import {clientService} from '../../api';
import {useLanguage} from '../../i18n/LanguageContext';
import IosIcon from '../Common/IosIcon';
import IosSheet from '../Common/IosSheet';
import ClientCreateForm from './ClientCreateForm';
import {ERROR_CODE_MESSAGES} from './clientErrorMessages';
import {
    LOOKUP_TABS,
    AUTO_LOOKUP_DEBOUNCE_MS,
    tabConfig,
    isSearchable,
    lookupArgs,
    clientRow,
    countLabel,
    createSeed,
    searchHint,
} from './clientLookupView';

// Everything the lookup step hands to the create step (ClientCreateForm)
// when the client turns out not to exist upstream, or the consultant jumps
// to create manually.
const EMPTY_SEED = {
    identification_number: '',
    phone: '',
    first_name: '',
    last_name: '',
};

const STEP_LOOKUP = 'lookup';
const STEP_CREATE = 'create';

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
 *
 * ClientCreateForm stays mounted once the consultant has visited the create
 * step at least once (`visitedCreate`), toggled only by CSS `hidden` rather
 * than a conditional render — the pre-redesign modal did the same (it only
 * ever toggled visibility, never unmounted). Without this, going back to the
 * lookup step and forward again would remount the form and lose every typed
 * field. Its `key` is derived from the seed's own values rather than the raw
 * tab/value pair, so tapping back-then-create-again with nothing changed
 * reuses the same instance (fields preserved), while a genuinely new search
 * that lands on a different seed remounts it fresh (fields reset).
 */
const ClientLookupSheet = ({open, onSelect, onClose, onRetail}) => {
    const {t} = useLanguage();
    const [step, setStep] = useState(STEP_LOOKUP);
    const [tab, setTab] = useState(LOOKUP_TABS[0]);
    const [value, setValue] = useState('');
    const [results, setResults] = useState([]);
    const [seed, setSeed] = useState(EMPTY_SEED);
    const [notFound, setNotFound] = useState(false);
    // Whether the consultant has reached the create step at least once this
    // time the sheet is open — see the component doc comment above.
    const [visitedCreate, setVisitedCreate] = useState(false);
    // In-flight indicator for runSearch: disables the trailing search/clear
    // control and shows a spinner in its place, so the field doesn't look
    // dead for the round trip.
    const [searching, setSearching] = useState(false);
    // Monotonic counter guarding against an out-of-order response: only the
    // response for the most recently started search is allowed to touch
    // state. Same pattern as ClientCreateForm's addressSearchSeq.
    const searchSeqRef = useRef(0);
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
            setVisitedCreate(false);
            setSearching(false);
            // Invalidate any search still in flight from a previous time the
            // sheet was open, so a late response can't act on fresh state.
            searchSeqRef.current += 1;
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
        const requestId = ++searchSeqRef.current;
        setSearching(true);
        try {
            const result = await clientService.checkClient(args);
            // A newer search has already started — this response belongs to
            // a query the consultant has since abandoned (edited the field,
            // or the debounce fired again). Drop it before it can touch
            // state, select a client, or overwrite a newer answer.
            if (requestId !== searchSeqRef.current) return;
            if (result.success) {
                const clients = Array.isArray(result.data?.clients) ? result.data.clients : [];
                // Preserve the typed identifier when upstream omits it, same as
                // the original lookup flow.
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
                setVisitedCreate(true);
            } else {
                showErrorMessage(result.code, result.error);
            }
        } finally {
            if (requestId === searchSeqRef.current) setSearching(false);
        }
    };

    useEffect(() => {
        // Not open, or not on the lookup step: nothing should search. A
        // rerender that leaves either condition true must still cancel a
        // previously scheduled timer — the sheet's own state lives above the
        // antd Drawer that unmounts its content on close, and the create
        // step is a sibling that stays mounted rather than unmounting this
        // effect's owner, so this bail is the only thing that stops a
        // pending search from firing after the consultant has closed the
        // sheet or moved on to create a client manually.
        if (!open) return undefined;
        if (step !== STEP_LOOKUP) return undefined;
        if (tabConfig(tab).trigger !== 'auto') return undefined;
        if (!isSearchable(tab, value)) return undefined;
        const timer = setTimeout(() => {
            runSearch();
        }, AUTO_LOOKUP_DEBOUNCE_MS);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab, value, open, step]);

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
        setVisitedCreate(true);
    };

    const config = tabConfig(tab);
    const showSearchAction = tab === 'name' && isSearchable(tab, value);
    const hintKey = searchHint(tab, value);
    // Reused whenever a fresh ClientCreateForm instance is warranted: the
    // seed's own values, not the raw tab/value pair, so returning to the
    // lookup step and creating again with nothing changed reuses the same
    // instance (see the component doc comment).
    const createFormKey = [seed.identification_number, seed.phone, seed.first_name, seed.last_name].join('|');

    const trailing = value ? (
        searching ? (
            <span className="if-search-trail" aria-hidden="true">
                <span className="if-spinner"/>
            </span>
        ) : showSearchAction ? (
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
            <div hidden={step !== STEP_LOOKUP}>
                <div className="if-toolbar">
                <Segmented
                    className="if-seg is-compact"
                    block
                    value={tab}
                    onChange={handleTabChange}
                    options={LOOKUP_TABS.map((tabKey) => ({
                        label: t[tabConfig(tabKey).labelKey],
                        value: tabKey,
                    }))}
                />
                <div className="if-search" aria-busy={searching || undefined}>
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
                {hintKey && <div className="if-field-hint if-search-hint">{t[hintKey]}</div>}
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
                                <span className="if-chev">
                                    <IosIcon name="chev" size={16} stroke={2.4}/>
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
            </div>
            {visitedCreate && (
                <div hidden={step !== STEP_CREATE}>
                    {notFound && (
                        <div className="if-banner">
                            <IosIcon name="info" size={20} stroke={2.2}/>
                            <span className="if-banner-text">{t.clientNotFoundCreate}</span>
                        </div>
                    )}
                    <ClientCreateForm
                        key={createFormKey}
                        seed={seed}
                        onCreated={onSelect}
                        registerSubmit={(fn, busy) => {
                            createSubmitRef.current = fn;
                            setCreateBusy(!!busy);
                        }}
                    />
                </div>
            )}
        </IosSheet>
    );
};

export default ClientLookupSheet;
