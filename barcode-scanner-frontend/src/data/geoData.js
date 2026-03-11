/**
 * Static geographic data for customer address fields.
 *
 * Structure:
 * - countries: list of countries (Georgia first)
 * - georgianCities: cities in Georgia with their districts
 * - countryCodes: common phone country calling codes (Georgia first)
 */

export const countries = [
    { value: 'GE', label: { ka: 'საქართველო', en: 'Georgia' } },
    { value: 'TR', label: { ka: 'თურქეთი', en: 'Turkey' } },
    { value: 'AZ', label: { ka: 'აზერბაიჯანი', en: 'Azerbaijan' } },
    { value: 'AM', label: { ka: 'სომხეთი', en: 'Armenia' } },
    { value: 'RU', label: { ka: 'რუსეთი', en: 'Russia' } },
    { value: 'UA', label: { ka: 'უკრაინა', en: 'Ukraine' } },
    { value: 'DE', label: { ka: 'გერმანია', en: 'Germany' } },
    { value: 'US', label: { ka: 'აშშ', en: 'United States' } },
    { value: 'GB', label: { ka: 'გაერთიანებული სამეფო', en: 'United Kingdom' } },
    { value: 'FR', label: { ka: 'საფრანგეთი', en: 'France' } },
    { value: 'IT', label: { ka: 'იტალია', en: 'Italy' } },
    { value: 'ES', label: { ka: 'ესპანეთი', en: 'Spain' } },
    { value: 'GR', label: { ka: 'საბერძნეთი', en: 'Greece' } },
    { value: 'IL', label: { ka: 'ისრაელი', en: 'Israel' } },
    { value: 'AE', label: { ka: 'არაბთა გაერთიანებული საამიროები', en: 'UAE' } },
    { value: 'CN', label: { ka: 'ჩინეთი', en: 'China' } },
    { value: 'OTHER', label: { ka: 'სხვა', en: 'Other' } },
];

/**
 * Georgian cities with their districts.
 * Key = city value, value = { label, districts[] }
 */
export const georgianCities = {
    tbilisi: {
        label: { ka: 'თბილისი', en: 'Tbilisi' },
        districts: [
            { value: 'vake', label: { ka: 'ვაკე', en: 'Vake' } },
            { value: 'saburtalo', label: { ka: 'საბურთალო', en: 'Saburtalo' } },
            { value: 'isani', label: { ka: 'ისანი', en: 'Isani' } },
            { value: 'samgori', label: { ka: 'სამგორი', en: 'Samgori' } },
            { value: 'didube', label: { ka: 'დიდუბე', en: 'Didube' } },
            { value: 'chughureti', label: { ka: 'ჩუღურეთ��', en: 'Chughureti' } },
            { value: 'krtsanisi', label: { ka: 'კრწანისი', en: 'Krtsanisi' } },
            { value: 'mtatsminda', label: { ka: 'მთაწმინდა', en: 'Mtatsminda' } },
            { value: 'nadzaladevi', label: { ka: 'ნაძალადევი', en: 'Nadzaladevi' } },
            { value: 'gldani', label: { ka: 'გლდანი', en: 'Gldani' } },
            { value: 'dighomi', label: { ka: 'დიღომი', en: 'Dighomi' } },
            { value: 'avlabari', label: { ka: 'ავლაბარი', en: 'Avlabari' } },
            { value: 'ortachala', label: { ka: 'ორთაჭალა', en: 'Ortachala' } },
            { value: 'varketili', label: { ka: 'ვარკეთილი', en: 'Varketili' } },
            { value: 'temqa', label: { ka: 'თემქა', en: 'Temqa' } },
            { value: 'lilo', label: { ka: 'ლილო', en: 'Lilo' } },
        ],
    },
    batumi: {
        label: { ka: 'ბათუმი', en: 'Batumi' },
        districts: [
            { value: 'old_batumi', label: { ka: 'ძველი ბათუმი', en: 'Old Batumi' } },
            { value: 'new_batumi', label: { ka: 'ახალი ბათუმი', en: 'New Batumi' } },
            { value: 'batumi_center', label: { ka: 'ც���ნტრი', en: 'Center' } },
        ],
    },
    kutaisi: {
        label: { ka: 'ქუთაისი', en: 'Kutaisi' },
        districts: [],
    },
    rustavi: {
        label: { ka: 'რუსთავი', en: 'Rustavi' },
        districts: [],
    },
    gori: {
        label: { ka: 'გორი', en: 'Gori' },
        districts: [],
    },
    zugdidi: {
        label: { ka: 'ზუგდიდი', en: 'Zugdidi' },
        districts: [],
    },
    poti: {
        label: { ka: 'ფოთი', en: 'Poti' },
        districts: [],
    },
    kobuleti: {
        label: { ka: 'ქობულეთი', en: 'Kobuleti' },
        districts: [],
    },
    khashuri: {
        label: { ka: 'ხაშური', en: 'Khashuri' },
        districts: [],
    },
    samtredia: {
        label: { ka: 'სამტრედია', en: 'Samtredia' },
        districts: [],
    },
    senaki: {
        label: { ka: 'სენაკი', en: 'Senaki' },
        districts: [],
    },
    zestaponi: {
        label: { ka: 'ზესტაფონი', en: 'Zestaponi' },
        districts: [],
    },
    marneuli: {
        label: { ka: 'მარნეული', en: 'Marneuli' },
        districts: [],
    },
    telavi: {
        label: { ka: 'თელავი', en: 'Telavi' },
        districts: [],
    },
    akhaltsikhe: {
        label: { ka: 'ახალციხე', en: 'Akhaltsikhe' },
        districts: [],
    },
    ozurgeti: {
        label: { ka: 'ოზურგეთი', en: 'Ozurgeti' },
        districts: [],
    },
    kaspi: {
        label: { ka: 'კასპი', en: 'Kaspi' },
        districts: [],
    },
    chiatura: {
        label: { ka: 'ჭიათურა', en: 'Chiatura' },
        districts: [],
    },
    tkibuli: {
        label: { ka: 'ტყიბული', en: 'Tkibuli' },
        districts: [],
    },
    bolnisi: {
        label: { ka: 'ბოლნისი', en: 'Bolnisi' },
        districts: [],
    },
    gardabani: {
        label: { ka: 'გარდაბანი', en: 'Gardabani' },
        districts: [],
    },
    mtskheta: {
        label: { ka: 'მცხეთა', en: 'Mtskheta' },
        districts: [],
    },
    other: {
        label: { ka: 'სხვა', en: 'Other' },
        districts: [],
    },
};

/**
 * Phone country calling codes.
 * Georgia (+995) is first.
 */
export const countryCodes = [
    { value: '+995', label: '🇬🇪 +995', country: 'Georgia' },
    { value: '+90', label: '🇹🇷 +90', country: 'Turkey' },
    { value: '+994', label: '🇦🇿 +994', country: 'Azerbaijan' },
    { value: '+374', label: '🇦🇲 +374', country: 'Armenia' },
    { value: '+7', label: '🇷🇺 +7', country: 'Russia' },
    { value: '+380', label: '🇺🇦 +380', country: 'Ukraine' },
    { value: '+49', label: '🇩🇪 +49', country: 'Germany' },
    { value: '+1', label: '🇺🇸 +1', country: 'USA' },
    { value: '+44', label: '🇬🇧 +44', country: 'UK' },
    { value: '+33', label: '🇫🇷 +33', country: 'France' },
    { value: '+39', label: '🇮🇹 +39', country: 'Italy' },
    { value: '+34', label: '🇪🇸 +34', country: 'Spain' },
    { value: '+30', label: '🇬🇷 +30', country: 'Greece' },
    { value: '+972', label: '🇮🇱 +972', country: 'Israel' },
    { value: '+971', label: '🇦🇪 +971', country: 'UAE' },
    { value: '+86', label: '🇨🇳 +86', country: 'China' },
];
