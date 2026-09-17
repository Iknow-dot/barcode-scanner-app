import React, {useCallback, useEffect, useId, useRef, useState} from 'react';
import {AutoComplete, Input, Segmented, message} from 'antd';
import {clientService} from '../../api';
import {useLanguage} from '../../i18n/LanguageContext';
import {isIndeterminateFailure, recoverCreatedClient} from './clientCreateRecovery';
import AddressMapPicker from './AddressMapPicker';
import IosIcon from '../Common/IosIcon';

// Ported verbatim from ClientLookupModal.js (and duplicated in
// ClientLookupSheet.js for the lookup step's own errors) — keep the three
// lists in sync until Task 5 removes the modal.
const ERROR_CODE_MESSAGES = {
    CLIENT_CREATE_UNVERIFIED: 'clientCreateUnverified',
    EXTERNAL_SERVICE_TIMEOUT: 'externalServiceTimeout',
    EXTERNAL_SERVICE_UNAVAILABLE: 'externalServiceUnavailable',
    EXTERNAL_SERVICE_UNAUTHORIZED: 'externalServiceUnauthorized',
    EXTERNAL_SERVICE_ERROR: 'externalServiceError',
    CLIENT_ALREADY_EXISTS: 'clientAlreadyExists',
};

// The upstream write may still be in flight when we gave up on the request,
// so a first "not found" is not proof the client was never created.
// (ClientLookupModal.js CREATE_RECOVERY_RETRY_MS.)
const CREATE_RECOVERY_RETRY_MS = 2500;
const ADDRESS_SEARCH_MIN_CHARS = 3;
const ADDRESS_SEARCH_DEBOUNCE_MS = 300;

/**
 * The create-client step of ClientLookupSheet: identification, person type,
 * name, phones, email and address, all as iOS list rows with the label
 * above the field. ClientLookupSheet renders the not-found banner (task 3);
 * `showNotFoundBanner` is accepted here only so the caller can tell us it
 * was shown — this component never renders a second one.
 *
 * `registerSubmit(fn, busy)` hands the sheet a submit function for its
 * navbar `შენახვა` action (re-registered every render, so the sheet always
 * calls the freshest closure) plus whether a create is currently in
 * flight, so the sheet can render the action disabled/busy rather than let
 * a double tap fire two concurrent, non-idempotent CreateClient calls;
 * `onCreated` is called with the created client on success, folded the
 * same way ClientLookupModal.js's handleCreate did.
 *
 * The three behaviours below are ported verbatim from ClientLookupModal.js:
 * RS.ge lookup (~291-321), create + recovery (~323-376) and the address
 * search including its addressSearchSeq guard (~394-441).
 */
const ClientCreateForm = ({seed, showNotFoundBanner, onCreated, registerSubmit}) => {
    const {t} = useLanguage();
    const isPhysLabelId = useId();

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
        // ClientLookupSheet only renders ClientCreateForm while
        // step === STEP_CREATE, so tapping back during a slow address
        // search unmounts this component — unlike ClientLookupModal.js,
        // which only toggled the Modal's visibility and never unmounted.
        // Invalidate any in-flight searchAddresses response the same way a
        // newer search already invalidates an older one, so a late reply
        // can't run against a torn-down instance.
        addressSearchSeq.current += 1;
    }, []);

    const showErrorMessage = (code, detail) => {
        const key = ERROR_CODE_MESSAGES[code];
        message.error((key && t[key]) || detail || t.clientCreateError);
    };

    // ClientLookupModal.js handleRsGeLookup (~291-321), verbatim.
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

    // ClientLookupModal.js handleCreate (~323-376), verbatim: the payload
    // shape, the isIndeterminateFailure -> recoverCreatedClient wiring, and
    // the upstream-wins fold on success. Guarded against a double tap of
    // the navbar save button — CreateClient is a non-idempotent write with
    // no upstream transaction id, so two concurrent calls can create two
    // separate client records for the same person.
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

    // ClientLookupModal.js runAddressSearch / handleAddressSearch (~394-441),
    // verbatim including the addressSearchSeq guard against a stale response.
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

    return (
        <>
            <div className="if-group">
                <div className="if-row">
                    <div className="if-row-main">
                        <span className="if-field-label">{t.customerIdNumber}</span>
                        <Input
                            variant="borderless"
                            className="if-field-input"
                            aria-label={t.customerIdNumber}
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

                <div className="if-row">
                    <span className="if-row-label" id={isPhysLabelId}>{t.isPhys}</span>
                    <Segmented
                        className="if-seg is-inset"
                        aria-labelledby={isPhysLabelId}
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
                        <span className="if-field-label">{t.firstName}</span>
                        <Input
                            variant="borderless"
                            className="if-field-input"
                            aria-label={t.firstName}
                            placeholder={t.firstName}
                            status={fieldErrors.first_name ? 'error' : ''}
                            value={firstName}
                            onChange={(event) => setFirstName(event.target.value)}
                        />
                        {fieldErrors.first_name && (
                            <div className="m-field-error" role="alert">{fieldErrors.first_name}</div>
                        )}
                    </div>
                </div>

                <div className="if-row">
                    <div className="if-row-main">
                        <span className="if-field-label">{t.lastName}</span>
                        <Input
                            variant="borderless"
                            className="if-field-input"
                            aria-label={t.lastName}
                            placeholder={t.lastName}
                            status={fieldErrors.last_name ? 'error' : ''}
                            value={lastName}
                            onChange={(event) => setLastName(event.target.value)}
                        />
                        {fieldErrors.last_name && (
                            <div className="m-field-error" role="alert">{fieldErrors.last_name}</div>
                        )}
                    </div>
                </div>
            </div>

            <div className="if-group m-create-gap">
                <div className="if-row">
                    <div className="if-row-main">
                        <span className="if-field-label">{t.customerPhone}</span>
                        <Input
                            variant="borderless"
                            className="if-field-input"
                            aria-label={t.customerPhone}
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
                        <span className="if-field-label">{t.secondaryPhone}</span>
                        <Input
                            variant="borderless"
                            className="if-field-input"
                            aria-label={t.secondaryPhone}
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
                        <span className="if-field-label">{t.customerEmail}</span>
                        <Input
                            variant="borderless"
                            className="if-field-input"
                            aria-label={t.customerEmail}
                            placeholder={t.customerEmail}
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                        />
                    </div>
                </div>
            </div>

            <h4 className="if-section-header">{t.customerAddress}</h4>
            <div className="if-group">
                <div className="if-row" aria-busy={(addressSearching || resolvingAddress) || undefined}>
                    <div className="if-row-main">
                        <span className="if-field-label">{t.addressLine}</span>
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
                                variant="borderless"
                                className="if-field-input"
                                aria-label={t.addressLine}
                                placeholder={t.addressLine}
                            />
                        </AutoComplete>
                        <span className="if-field-hint">{t.addressSearchHint}</span>
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
        </>
    );
};

export default ClientCreateForm;
