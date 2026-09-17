import React, {useEffect, useState} from 'react';
import IosIcon from './IosIcon';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * iOS stepper: − value +, with 44 px targets. The value is also a numeric
 * field so a large quantity can be typed; a typed value commits on blur or
 * Enter, clamped to [min, max], and only when it differs from `value`.
 * Callers pass translated labels: `label` names the field and the group,
 * the other two name the buttons. `minSlot`, when given, takes the minus
 * button's place at the minimum (the cart puts its delete button there).
 */
const QuantityStepper = ({
    value,
    min = 1,
    max = Infinity,
    onChange,
    disabled = false,
    label,
    decrementLabel,
    incrementLabel,
    iconSize = 20,
    minSlot,
}) => {
    const [draft, setDraft] = useState(String(value));

    useEffect(() => {
        setDraft(String(value));
    }, [value]);

    const change = (next) => {
        const clamped = clamp(next, min, max);
        if (clamped !== value) onChange(clamped);
    };

    const commitDraft = () => {
        const typed = parseInt(draft, 10);
        if (Number.isFinite(typed)) change(typed);
        // Show the committed value; a parent that saves asynchronously
        // updates `value` (and so this field) when the save lands.
        setDraft(String(value));
    };

    return (
        <div className="if-stepper" role="group" aria-label={label}>
            {minSlot && value <= min ? minSlot : (
                <button
                    type="button"
                    className="if-stepper-btn"
                    aria-label={decrementLabel}
                    disabled={disabled || value <= min}
                    onClick={() => change(value - 1)}
                >
                    <IosIcon name="minus" size={iconSize} stroke={2.4}/>
                </button>
            )}
            <input
                className="if-stepper-value"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                aria-label={label}
                value={draft}
                disabled={disabled}
                onChange={(event) => setDraft(event.target.value.replace(/[^0-9]/g, ''))}
                onBlur={commitDraft}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                }}
            />
            <button
                type="button"
                className="if-stepper-btn"
                aria-label={incrementLabel}
                disabled={disabled || value >= max}
                onClick={() => change(value + 1)}
            >
                <IosIcon name="plus" size={iconSize} stroke={2.4}/>
            </button>
        </div>
    );
};

export default QuantityStepper;
