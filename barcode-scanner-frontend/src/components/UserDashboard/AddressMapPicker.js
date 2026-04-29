import React, {useState} from 'react';
import {MapContainer, TileLayer, Marker, useMapEvents} from 'react-leaflet';
import L from 'leaflet';
import {message} from 'antd';
import {clientService} from '../../api';
import {useLanguage} from '../../i18n/LanguageContext';

// react-leaflet ships PNG asset URLs that webpack can't resolve at runtime
// without a manual override — point Leaflet's default icon at the package's
// own image files served via webpack-loader URLs.
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';

L.Icon.Default.mergeOptions({
    iconUrl,
    iconRetinaUrl,
    shadowUrl,
});

const TBILISI_CENTER = [41.7151, 44.8271];
const DEFAULT_ZOOM = 12;

const ClickHandler = ({onPick}) => {
    useMapEvents({
        click: (e) => {
            onPick(e.latlng);
        },
    });
    return null;
};

const AddressMapPicker = ({onAddressResolved, onResolvingChange, height = 250}) => {
    const {t} = useLanguage();
    const [position, setPosition] = useState(null);

    const resolve = async ({lat, lng}) => {
        if (onResolvingChange) onResolvingChange(true);
        try {
            const result = await clientService.reverseGeocode({lat, lng});
            const address = result.success ? result.data?.address : null;
            if (address) {
                onAddressResolved(address);
            } else {
                message.warning(t.reverseGeocodeError);
            }
        } finally {
            if (onResolvingChange) onResolvingChange(false);
        }
    };

    const handlePick = (latlng) => {
        setPosition(latlng);
        resolve(latlng);
    };

    return (
        <div style={{height, borderRadius: 8, overflow: 'hidden', border: '1px solid #d9d9d9'}}>
            <MapContainer
                center={TBILISI_CENTER}
                zoom={DEFAULT_ZOOM}
                style={{height: '100%', width: '100%'}}
                scrollWheelZoom={false}
            >
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <ClickHandler onPick={handlePick}/>
                {position && (
                    <Marker
                        position={position}
                        draggable
                        eventHandlers={{
                            dragend: (e) => {
                                const latlng = e.target.getLatLng();
                                setPosition(latlng);
                                resolve(latlng);
                            },
                        }}
                    />
                )}
            </MapContainer>
        </div>
    );
};

export default AddressMapPicker;
