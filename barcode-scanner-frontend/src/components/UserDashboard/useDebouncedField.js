import {useCallback, useEffect, useRef, useState} from 'react';

/**
 * Local state for a text field that saves to the order after a pause in
 * typing (moved unchanged from OrderPanel). Returns [value, onChange, flush];
 * call flush on blur so leaving the field saves at once.
 */
const useDebouncedField = (initialValue, onSave, delay = 600) => {
    const [localValue, setLocalValue] = useState(initialValue);
    const timerRef = useRef(null);
    const latestValueRef = useRef(localValue);

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
            onSave(value);
        }, delay);
    }, [onSave, delay]);

    useEffect(() => {
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, []);

    const flush = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
            onSave(latestValueRef.current);
        }
    }, [onSave]);

    return [localValue, handleChange, flush];
};

export default useDebouncedField;
