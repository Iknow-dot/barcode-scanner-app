import React from 'react';
import {render, screen, fireEvent} from '@testing-library/react';
import QuantityStepper from './QuantityStepper';

const renderStepper = (props = {}) => {
    const onChange = jest.fn();
    const utils = render(
        <QuantityStepper
            value={2}
            min={1}
            max={5}
            onChange={onChange}
            label="Quantity"
            decrementLabel="Decrease quantity"
            incrementLabel="Increase quantity"
            {...props}
        />
    );
    return {onChange, ...utils};
};

describe('QuantityStepper', () => {
    it('is a labelled group showing the value', () => {
        renderStepper();
        expect(screen.getByRole('group', {name: 'Quantity'})).toBeInTheDocument();
        expect(screen.getByRole('textbox', {name: 'Quantity'})).toHaveValue('2');
    });

    it('steps the value down and up by one', () => {
        const {onChange} = renderStepper();
        fireEvent.click(screen.getByRole('button', {name: 'Increase quantity'}));
        expect(onChange).toHaveBeenLastCalledWith(3);
        fireEvent.click(screen.getByRole('button', {name: 'Decrease quantity'}));
        expect(onChange).toHaveBeenLastCalledWith(1);
    });

    it('disables minus at the minimum and plus at the maximum', () => {
        const {rerender} = renderStepper({value: 1});
        expect(screen.getByRole('button', {name: 'Decrease quantity'})).toBeDisabled();
        expect(screen.getByRole('button', {name: 'Increase quantity'})).not.toBeDisabled();
        rerender(
            <QuantityStepper value={5} min={1} max={5} onChange={() => {}} label="Quantity"
                             decrementLabel="Decrease quantity" incrementLabel="Increase quantity"/>
        );
        expect(screen.getByRole('button', {name: 'Increase quantity'})).toBeDisabled();
        expect(screen.getByRole('button', {name: 'Decrease quantity'})).not.toBeDisabled();
    });

    it('commits a typed value on blur, clamped to the range', () => {
        const {onChange} = renderStepper();
        const field = screen.getByRole('textbox', {name: 'Quantity'});
        fireEvent.change(field, {target: {value: '12'}});
        fireEvent.blur(field);
        expect(onChange).toHaveBeenCalledWith(5);
    });

    it('ignores a cleared field and shows the value again', () => {
        const {onChange} = renderStepper();
        const field = screen.getByRole('textbox', {name: 'Quantity'});
        fireEvent.change(field, {target: {value: ''}});
        fireEvent.blur(field);
        expect(onChange).not.toHaveBeenCalled();
        expect(field).toHaveValue('2');
    });

    it('puts the min slot in place of minus at the minimum only', () => {
        const slot = <button type="button">Delete</button>;
        const {rerender} = renderStepper({value: 1, minSlot: slot});
        expect(screen.getByRole('button', {name: 'Delete'})).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: 'Decrease quantity'})).toBeNull();
        rerender(
            <QuantityStepper value={2} min={1} max={5} onChange={() => {}} label="Quantity"
                             decrementLabel="Decrease quantity" incrementLabel="Increase quantity" minSlot={slot}/>
        );
        expect(screen.queryByRole('button', {name: 'Delete'})).toBeNull();
        expect(screen.getByRole('button', {name: 'Decrease quantity'})).toBeInTheDocument();
    });

    it('turns everything off when disabled', () => {
        renderStepper({disabled: true});
        expect(screen.getByRole('button', {name: 'Decrease quantity'})).toBeDisabled();
        expect(screen.getByRole('button', {name: 'Increase quantity'})).toBeDisabled();
        expect(screen.getByRole('textbox', {name: 'Quantity'})).toBeDisabled();
    });
});
