import dayjs from 'dayjs';

// Rules of the delivery step, moved unchanged from OrderPanel's
// DeliverySection.

export const isDeliveryOrder = (order) => order?.delivery_type === 'delivery';

/** +995 and 9 digits, or 9 digits, or empty (spaces ignored). */
export const recipientPhoneValid = (phone) => (
    !phone || /^(\+995)?\d{9}$/.test(phone.replace(/\s+/g, ''))
);

/**
 * Patch for the recipient segmented control. Switching back to "same"
 * clears the other recipient's fields so the saved state matches the screen.
 */
export const recipientPatch = (value) => (
    value === 'different'
        ? {recipient_is_different: true}
        : {
            recipient_is_different: false,
            recipient_first_name: '',
            recipient_last_name: '',
            recipient_phone: '',
        }
);

/** A stored "HH:mm[:ss]" time as a dayjs value for the time picker. */
export const timeValue = (value) => {
    if (!value) return null;
    const parsed = dayjs(`2000-01-01T${value}`);
    return parsed.isValid() ? parsed : null;
};

/** A stored "YYYY-MM-DD" date as a dayjs value for the date picker. */
export const dateValue = (value) => {
    if (!value) return null;
    const parsed = dayjs(value);
    return parsed.isValid() ? parsed : null;
};
