import {useCallback, useEffect, useRef, useState} from 'react';

/**
 * Local state for a text field that saves to the order after a pause in
 * typing (moved unchanged from OrderPanel, plus flush-on-unmount below).
 * Returns [value, onChange, flush]; call flush on blur so leaving the field
 * saves at once.
 *
 * DeliveryStep is one step of a wizard sheet, so unmounting mid-debounce
 * (switching steps, closing the sheet) is routine, not exceptional — without
 * this, an edit that never got a blur is silently dropped. onSave and the
 * latest value live in refs so the unmount cleanup (whose effect body only
 * runs once, on mount) never calls a stale onSave closure. flush() and the
 * cleanup share the same "is a save still pending" check (timerRef), so a
 * normal blur-then-unmount only saves once.
 *
 * The prop-sync effect below must never overwrite text the user is still
 * typing (DeliveryStep renders six of these off the same order, so a blur
 * on one field's immediate PATCH landing can re-render this one mid-edit).
 * Two guards: skip entirely while a debounce timer is pending, and — for the
 * narrow window after a save is sent but before its own response has been
 * seen — accept only a prop value that matches what was just saved. Once
 * that echo is observed the gate clears, so any later, genuinely different
 * prop value (a real external change) syncs normally again.
 */
const useDebouncedField = (initialValue, onSave, delay = 600) => {
    const [localValue, setLocalValue] = useState(initialValue);
    const timerRef = useRef(null);
    const latestValueRef = useRef(localValue);
    const onSaveRef = useRef(onSave);
    onSaveRef.current = onSave;
    // The value most recently handed to onSave, while its echo hasn't been
    // seen back through `initialValue` yet; undefined once confirmed (or
    // before anything has ever been saved).
    const lastSavedRef = useRef(undefined);

    useEffect(() => {
        if (timerRef.current) return; // actively editing; never clobber
        if (lastSavedRef.current !== undefined) {
            if (initialValue !== lastSavedRef.current) return; // stale echo of a save still in flight
            lastSavedRef.current = undefined; // confirmed — resume normal syncing
        }
        if (initialValue !== latestValueRef.current) {
            setLocalValue(initialValue);
            latestValueRef.current = initialValue;
        }
    }, [initialValue]);

    const handleChange = useCallback((value) => {
        setLocalValue(value);
        latestValueRef.current = value;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
            timerRef.current = null;
            lastSavedRef.current = value;
            onSaveRef.current(value);
        }, delay);
    }, [delay]);

    // Returns the pending save's promise (or undefined when nothing was
    // pending) so a caller that needs the save to land first — OrderSheet's
    // confirm path — can await it.
    const flush = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
            lastSavedRef.current = latestValueRef.current;
            return onSaveRef.current(latestValueRef.current);
        }
        return undefined;
    }, []);

    useEffect(() => {
        return () => {
            if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
                onSaveRef.current(latestValueRef.current);
            }
        };
    }, []);

    return [localValue, handleChange, flush];
};

export default useDebouncedField;
