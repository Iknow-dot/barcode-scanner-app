import React from 'react';
import {render, screen, fireEvent} from '@testing-library/react';
import GiftCounter from './GiftCounter';

describe('GiftCounter', () => {
  it('renders nothing when the org has gifts disabled', () => {
    const {container} = render(
      <GiftCounter enabled={false} totalQty={3} giftQty={0} onChange={() => {}} label="Gift"/>
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('idle pill requests one gift', () => {
    const onChange = jest.fn();
    render(<GiftCounter enabled totalQty={3} giftQty={0} onChange={onChange} label="Gift"/>);
    fireEvent.click(screen.getByRole('button', {name: 'Gift'}));
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it('active pill clears all gifts and shows the split', () => {
    const onChange = jest.fn();
    render(<GiftCounter enabled totalQty={3} giftQty={1} onChange={onChange} label="Gift"/>);
    const pill = screen.getByRole('button', {name: 'Gift'});
    expect(pill).toHaveTextContent('1/3');
    fireEvent.click(pill);
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('mini stepper steps the gift count both ways', () => {
    const onChange = jest.fn();
    render(<GiftCounter enabled totalQty={3} giftQty={1} onChange={onChange} label="Gift"/>);
    fireEvent.click(screen.getByRole('button', {name: 'Gift +'}));
    expect(onChange).toHaveBeenCalledWith(2);
    fireEvent.click(screen.getByRole('button', {name: 'Gift −'}));
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('cannot step past the line quantity', () => {
    render(<GiftCounter enabled totalQty={2} giftQty={2} onChange={() => {}} label="Gift"/>);
    expect(screen.getByRole('button', {name: 'Gift +'})).toBeDisabled();
  });

  it('hides the mini stepper when nothing is gifted', () => {
    render(<GiftCounter enabled totalQty={2} giftQty={0} onChange={() => {}} label="Gift"/>);
    expect(screen.queryByRole('button', {name: 'Gift +'})).toBeNull();
  });
});
