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
 */
const useDebouncedField = (initialValue, onSave, delay = 600) => {
    const [localValue, setLocalValue] = useState(initialValue);
    const timerRef = useRef(null);
    const latestValueRef = useRef(localValue);
    const onSaveRef = useRef(onSave);
    onSaveRef.current = onSave;

    useEffect(() => {
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
            onSaveRef.current(value);
        }, delay);
    }, [delay]);

    const flush = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
            onSaveRef.current(latestValueRef.current);
        }
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
