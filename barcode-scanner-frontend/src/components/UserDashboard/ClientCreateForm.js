import React, {useCallback, useEffect, useId, useRef, useState} from 'react';
import {AutoComplete, Input, Segmented, message} from 'antd';
import {clientService} from '../../api';
import {useLanguage} from '../../i18n/LanguageContext';
import {isIndeterminateFailure, recoverCreatedClient} from './clientCreateRecovery';
import {ERROR_CODE_MESSAGES} from './clientErrorMessages';
import AddressMapPicker from './AddressMapPicker';
import IosIcon from '../Common/IosIcon';

// The upstream write may still be in flight when we gave up on the request,
// so a first "not found" is not proof the client was never created.
const CREATE_RECOVERY_RETRY_MS = 2500;
const ADDRESS_SEARCH_MIN_CHARS = 3;
const ADDRESS_SEARCH_DEBOUNCE_MS = 300;

/**
 * The create-client step of ClientLookupSheet: identification, person type,
 * name, phones, email and address, all as iOS list rows with the label
 * above the field. ClientLookupSheet owns the not-found banner; this
 * component never renders one of its own.
 *
 * `registerSubmit(fn, busy)` hands the sheet a submit function for its
 * navbar `შენახვა` action (re-registered every render, so the sheet always
 * calls the freshest closure) plus whether a create is currently in
 * flight, so the sheet can render the action disabled/busy rather than let
 * a double tap fire two concurrent, non-idempotent CreateClient calls;
 * `onCreated` is called with the created client on success, with the
 * upstream response folded over the typed values so a field upstream
 * omitted still carries what the consultant typed.
 *
 * The three behaviours below are ported verbatim from the pre-redesign
 * client-lookup modal: the RS.ge lookup, create-with-recovery, and the
 * address search including its addressSearchSeq guard.
 */
const ClientCreateForm = ({seed, onCreated, registerSubmit}) => {
    const {t} = useLanguage();
    // Real <label for>/id pairs so tapping a label focuses its field and a
    // screen reader announces the two as one control, rather than relying on
    // a duplicate aria-label with no programmatic link to the input.
    const idNumberFieldId = useId();
    const firstNameFieldId = useId();
    const firstNameErrorId = useId();
    const lastNameFieldId = useId();
    const lastNameErrorId = useId();
    const phoneFieldId = useId();
    const phone2FieldId = useId();
    const emailFieldId = useId();
    const addressFieldId = useId();

    const [idNumber, setIdNumber] = useState(seed?.identification_number || '');
    const [isPhys, setIsPhys] = useState(true);
    const [firstName, setFirstName] = useState(seed?.first_name || '');
    const [lastName, setLastName] = useState(seed?.last_name || '');
    const [phone, setPhone] = useState(seed?.phone || '');
    const [phone2, setPhone2] = useState('');
    const [email, setEmail] = useState('');
    const [addressLine, setAddressLine] = useState('');
    const [fieldErrors, setFieldErrors] = useState({});
    const [rsGeLoading, setRsGeLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [addressOptions, setAddressOptions] = useState([]);
    const [addressSearching, setAddressSearching] = useState(false);
    const [resolvingAddress, setResolvingAddress] = useState(false);
    const [mapPosition, setMapPosition] = useState(null);
    const addressSearchTimer = useRef(null);
    const addressSearchSeq = useRef(0);
    // Mirrors `submitting` but read synchronously inside handleSubmit: two
    // taps of the navbar save button in the same tick both close over
    // whatever `submitting` was at render time (stale, still false), so the
    // React-state read alone can't stop a second concurrent create. A ref is
    // updated immediately, before the first `await`, so the second call sees
    // it. (The same class of bug useDebouncedField's in-flight gate hit.)
    const submittingRef = useRef(false);

    useEffect(() => () => {
        if (addressSearchTimer.current) clearTimeout(addressSearchTimer.current);
        // This component can genuinely unmount — the sheet closing, or a
        // fresh search landing on a different seed and remounting a clean
        // instance (see ClientLookupSheet.js's `createFormKey`). Invalidate
        // any in-flight searchAddresses response the same way a newer
        // search already invalidates an older one, so a late reply can't
        // run against a torn-down instance.
        addressSearchSeq.current += 1;
    }, []);

    const showErrorMessage = (code, detail) => {
        const key = ERROR_CODE_MESSAGES[code];
        message.error((key && t[key]) || detail || t.clientCreateError);
    };

    // The RS.ge lookup below is ported verbatim from the pre-redesign modal.
    const handleRsGeLookup = async () => {
        const trimmedId = (idNumber || '').trim();
        if (!trimmedId) {
            message.warning(t.customerIdNumberRequired);
            return;
        }
        setRsGeLoading(true);
        try {
            const result = await clientService.lookupRsGe(trimmedId);
            if (result.success && result.data) {
                const {first_name, last_name} = result.data;
                if (first_name) setFirstName(first_name);
                if (last_name) setLastName(last_name);
                message.success(t.rsGeFound);
            } else {
                const errorCode = result.code;
                if (errorCode === 'RS_GE_NOT_FOUND' || result.status === 404) {
                    message.warning(t.rsGeNotFound);
                } else if (errorCode === 'RS_GE_TIMEOUT' || result.status === 504) {
                    message.error(t.rsGeTimeout);
                } else {
                    message.error(t.rsGeError);
                }
            }
        } finally {
            setRsGeLoading(false);
        }
    };

    // Create-with-recovery, ported verbatim from the pre-redesign modal: the
    // payload shape, the isIndeterminateFailure -> recoverCreatedClient
    // wiring, and the upstream-wins fold on success. Guarded against a
    // double tap of the navbar save button — CreateClient is a
    // non-idempotent write with no upstream transaction id, so two
    // concurrent calls can create two separate client records for the same
    // person.
    const handleSubmit = async () => {
        if (submittingRef.current) return;

        const errors = {};
        if (!firstName.trim()) errors.first_name = t.firstNameRequired;
        if (!lastName.trim()) errors.last_name = t.lastNameRequired;
        setFieldErrors(errors);
        if (Object.keys(errors).length > 0) return;

        submittingRef.current = true;
        setSubmitting(true);
        try {
            const payload = {
                first_name: firstName,
                last_name: lastName,
                identification_number: idNumber || '',
                is_phys: isPhys !== false,
                phone: phone || '',
                phone_2: phone2 || '',
                email: email || '',
                address_line: addressLine || '',
            };
            let result = await clientService.createClient(payload);
            if (isIndeterminateFailure(result)) {
                // We cannot tell whether 1C committed: the platform router may
                // have discarded our API's answer (its own 502 page), or the
                // API may have failed to confirm. Ask whether the client is
                // there now rather than sending the consultant to create a
                // duplicate.
                const {found, checked} = await recoverCreatedClient(
                    payload,
                    clientService.checkClient,
                    {delay: () => new Promise((resolve) => setTimeout(resolve, CREATE_RECOVERY_RETRY_MS))},
                );
                if (found) {
                    result = {success: true, data: found};
                } else if (!checked) {
                    message.warning(t.clientCreateUnverified);
                    return;
                }
            }
            if (result.success) {
                message.success(t.clientCreated);
                // Upstream returns name/address/phone; fold the typed values
                // back in so the caller can still attach the personal_number
                // and the just-created name/address even if the upstream
                // payload omits any of them.
                const typedName = [firstName, lastName].filter(Boolean).join(' ').trim();
                onCreated({
                    ...result.data,
                    name: result.data?.name || typedName,
                    identification_number: result.data?.identification_number || idNumber || '',
                    phone: result.data?.phone || phone || '',
                    address: result.data?.address || addressLine || '',
                });
            } else {
                showErrorMessage(result.code, result.error);
            }
        } finally {
            submittingRef.current = false;
            setSubmitting(false);
        }
    };

    // Re-registered every render so the sheet always holds the closure with
    // the latest field values, plus the current busy state so the sheet's
    // navbar save action can render itself disabled while a create is in
    // flight (it has no other way to know — registerSubmit is the only
    // channel from this form back to the sheet).
    useEffect(() => {
        if (registerSubmit) registerSubmit(handleSubmit, submitting);
    });

    const handleAddressResolved = (address) => {
        setAddressLine(address);
    };

    // The address search, ported verbatim from the pre-redesign modal,
    // including the addressSearchSeq guard against a stale response.
    const runAddressSearch = useCallback(async (query) => {
        const trimmed = (query || '').trim();
        if (trimmed.length < ADDRESS_SEARCH_MIN_CHARS) {
            setAddressOptions([]);
            setAddressSearching(false);
            return;
        }
        const requestId = ++addressSearchSeq.current;
        setAddressSearching(true);
        const result = await clientService.searchAddresses(trimmed);
        // A newer search has already been kicked off — drop this response so
        // we don't flicker stale options into the list.
        if (requestId !== addressSearchSeq.current) return;
        if (result.success) {
            const suggestions = Array.isArray(result.data?.suggestions) ? result.data.suggestions : [];
            setAddressOptions(
                suggestions.map((s) => ({
                    value: s.label,
                    label: s.label,
                    lat: s.lat,
                    lng: s.lng,
                })),
            );
        } else {
            setAddressOptions([]);
        }
        setAddressSearching(false);
    }, []);

    const handleAddressSearch = (value) => {
        if (addressSearchTimer.current) {
            clearTimeout(addressSearchTimer.current);
        }
        const trimmed = (value || '').trim();
        if (trimmed.length < ADDRESS_SEARCH_MIN_CHARS) {
            addressSearchSeq.current += 1;
            setAddressOptions([]);
            setAddressSearching(false);
            return;
        }
        addressSearchTimer.current = setTimeout(() => {
            runAddressSearch(trimmed);
        }, ADDRESS_SEARCH_DEBOUNCE_MS);
    };

    // Wraps handleSubmit for the native <form>: the keyboard's return/Go key
    // submits a text input inside a <form> by default, which the modal this
    // replaces relied on (an antd Form with htmlType="submit"). noValidate
    // keeps the browser's own required/pattern UI out of the way — field
    // validation is handleSubmit's job, same as before.
    const handleFormSubmit = (event) => {
        event.preventDefault();
        handleSubmit();
    };

    const addressBusy = addressSearching || resolvingAddress;

    return (
        <form onSubmit={handleFormSubmit} noValidate>
            <div className="if-group">
                <div className="if-row">
                    <div className="if-row-main">
                        <label className="if-field-label" htmlFor={idNumberFieldId}>{t.customerIdNumber}</label>
                        <Input
                            id={idNumberFieldId}
                            variant="borderless"
                            className="if-field-input"
                            placeholder={t.customerIdNumber}
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={idNumber}
                            onChange={(event) => setIdNumber(event.target.value)}
                        />
                    </div>
                    <button
                        type="button"
                        className="if-pill is-on"
                        disabled={rsGeLoading}
                        onClick={handleRsGeLookup}
                    >
                        <IosIcon name="cloud" size={16} stroke={2.4}/>
                        {rsGeLoading ? t.lookingUpRsGe : t.lookupFromRsGe}
                    </button>
                </div>

                <div className="if-row m-isphys-row">
                    <Segmented
                        className="if-seg is-inset"
                        block
                        aria-label={t.isPhys}
                        value={isPhys}
                        onChange={setIsPhys}
                        options={[
                            {label: t.physicalPerson, value: true},
                            {label: t.legalEntity, value: false},
                        ]}
                    />
                </div>

                <div className="if-row">
                    <div className="if-row-main">
                        <label className="if-field-label" htmlFor={firstNameFieldId}>
                            {t.firstName} <span className="m-required" aria-hidden="true">*</span>
                        </label>
                        <Input
                            id={firstNameFieldId}
                            variant="borderless"
                            className="if-field-input"
                            placeholder={t.firstName}
                            status={fieldErrors.first_name ? 'error' : ''}
                            aria-invalid={fieldErrors.first_name ? 'true' : undefined}
                            aria-describedby={fieldErrors.first_name ? firstNameErrorId : undefined}
                            value={firstName}
                            onChange={(event) => setFirstName(event.target.value)}
                        />
                        {fieldErrors.first_name && (
                            <div id={firstNameErrorId} className="m-field-error" role="alert">
                                {fieldErrors.first_name}
                            </div>
                        )}
                    </div>
                </div>

                <div className="if-row">
                    <div className="if-row-main">
                        <label className="if-field-label" htmlFor={lastNameFieldId}>
                            {t.lastName} <span className="m-required" aria-hidden="true">*</span>
                        </label>
                        <Input
                            id={lastNameFieldId}
                            variant="borderless"
                            className="if-field-input"
                            placeholder={t.lastName}
                            status={fieldErrors.last_name ? 'error' : ''}
                            aria-invalid={fieldErrors.last_name ? 'true' : undefined}
                            aria-describedby={fieldErrors.last_name ? lastNameErrorId : undefined}
                            value={lastName}
                            onChange={(event) => setLastName(event.target.value)}
                        />
                        {fieldErrors.last_name && (
                            <div id={lastNameErrorId} className="m-field-error" role="alert">
                                {fieldErrors.last_name}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="if-group m-create-gap">
                <div className="if-row">
                    <div className="if-row-main">
                        <label className="if-field-label" htmlFor={phoneFieldId}>{t.customerPhone}</label>
                        <Input
                            id={phoneFieldId}
                            variant="borderless"
                            className="if-field-input"
                            placeholder={t.customerPhone}
                            inputMode="tel"
                            type="tel"
                            value={phone}
                            onChange={(event) => setPhone(event.target.value)}
                        />
                    </div>
                </div>

                <div className="if-row">
                    <div className="if-row-main">
                        <label className="if-field-label" htmlFor={phone2FieldId}>{t.secondaryPhone}</label>
                        <Input
                            id={phone2FieldId}
                            variant="borderless"
                            className="if-field-input"
                            placeholder={t.secondaryPhone}
                            inputMode="tel"
                            type="tel"
                            value={phone2}
                            onChange={(event) => setPhone2(event.target.value)}
                        />
                    </div>
                </div>

                <div className="if-row">
                    <div className="if-row-main">
                        <label className="if-field-label" htmlFor={emailFieldId}>{t.customerEmail}</label>
                        <Input
                            id={emailFieldId}
                            variant="borderless"
                            className="if-field-input"
                            placeholder={t.customerEmail}
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                        />
                    </div>
                </div>
            </div>

            <h4 className="if-section-header">{t.customerAddress}</h4>
            <div className="if-group">
                <div className="if-row" aria-busy={addressBusy || undefined}>
                    <div className="if-row-main">
                        <label className="if-field-label" htmlFor={addressFieldId}>{t.addressLine}</label>
                        <AutoComplete
                            className="if-field-input"
                            value={addressLine}
                            options={addressOptions}
                            onSearch={handleAddressSearch}
                            onChange={setAddressLine}
                            onSelect={(_, option) => {
                                if (typeof option?.lat === 'number' && typeof option?.lng === 'number') {
                                    setMapPosition({lat: option.lat, lng: option.lng});
                                }
                            }}
                            filterOption={false}
                        >
                            <Input
                                id={addressFieldId}
                                variant="borderless"
                                className="if-field-input"
                                placeholder={t.addressLine}
                                suffix={addressBusy ? <span className="if-spinner" aria-hidden="true"/> : null}
                            />
                        </AutoComplete>
                        <span className="if-field-hint">
                            {addressSearching ? t.addressSearching : t.addressSearchHint}
                        </span>
                    </div>
                </div>
            </div>

            <div className="m-address-map">
                <AddressMapPicker
                    position={mapPosition}
                    onPositionChange={setMapPosition}
                    onAddressResolved={handleAddressResolved}
                    onResolvingChange={setResolvingAddress}
                />
            </div>

            {/* With several text fields and no visible submit control, most
                browsers won't implicitly submit the form on Enter — a real
                (if invisible) submit button restores that keyboard behaviour. */}
            <button type="submit" hidden aria-hidden="true" tabIndex={-1}/>
        </form>
    );
};

export default ClientCreateForm;
