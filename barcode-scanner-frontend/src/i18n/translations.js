const translations = {
    ka: {
        // ===== Common =====
        search: 'ძებნა',
        clear: 'გასუფთავება',
        add: 'დამატება',
        save: 'შენახვა',
        delete: 'წაშლა',
        close: 'დახურვა',
        yes: 'დიახ',
        no: 'არა',
        error: 'შეცდომა',
        success: 'წარმატება',
        result: 'შედეგი',
        loading: 'იტვირთება...',
        confirmDelete: 'გსურთ წაშლა?',
        logout: 'გასვლა',
        language: 'ენა',
        georgian: 'ქართული',
        english: 'English',

        // ===== Login =====
        username: 'მომხმარებელი სახელი',
        password: 'პაროლი',
        login: 'შესვლა',
        usernameRequired: 'გთხოვთ შეიყვანოთ მომხმარებლის სახელი!',
        passwordRequired: 'გთხოვთ შეიყვანოთ პაროლი!',
        invalidCredentials: 'მომხმარებელი ან პაროლი არასწორია',

        // ===== Login Errors =====
        ipNotAllowed: 'თქვენი IP მისამართი არ არის დაშვებული. გთხოვთ, დაუკავშირდით ადმინისტრატორს.',

        // ===== Dashboard / Product Search =====
        productSearch: 'პროდუქტის ძიება',
        productSearchSubtitle: 'მოძებნეთ პროდუქტი შტრიხკოდის ან არტიკულის მიხედვით',
        searchingProduct: 'ვეძებ პროდუქტს...',
        barcode: 'შტრიხკოდი',
        article: 'არტიკული',
        product: 'პროდუქტი',
        allWarehouses: 'ყველა საწყობი',
        scan: 'დასკანერება',
        searchPlaceholder: 'ძიება',
        selectSearchType: 'გთხოვთ აირჩიოთ ძიების ტიპი!',
        enterSearchText: 'გთხოვთ შეიყვანოთ ძიების ტექსტი!',
        warehouse: 'საწყობი',
        balance: 'ნაშთი',
        price: 'ფასი',

        // ===== Product Search Errors =====
        productNotFound: 'პროდუქტი ვერ მოიძებნა ვებ სერვისში',
        externalServiceTimeout: 'ვებ სერვისთან კავშირის დრო ამოიწურა. გთხოვთ, სცადოთ მოგვიანებით.',
        externalServiceUnavailable: 'ვებ სერვისთან დაკავშირება ვერ მოხერხდა. გთხოვთ, სცადოთ მოგვიანებით.',
        externalServiceError: 'ვებ სერვისთან კომუნიკაციის შეცდომა. გთხოვთ, სცადოთ მოგვიანებით.',
        externalServiceUnauthorized: 'ვებ სერვისზე ავტორიზაცია ვერ მოხერხდა. გთხოვთ, დაუკავშირდით ადმინისტრატორს.',
        webServiceError: 'ვებ სერვისის შეცდომა',
        productSearchError: 'პროდუქტის ძიებისას მოხდა შეცდომა',
        productNotFoundOrNoBalance: 'პროდუქტი ვერ მოიძებნა ან ნაშთი არ არსებობს',

        // ===== System Admin Dashboard =====
        organizations: 'ორგანიზაციები',
        warehouses: 'საწყობები',
        users: 'მომხმარებლები',

        // ===== Organizations =====
        organization: 'ორგანიზაცია',
        addOrganization: 'ორგანიზაციის დამატება',
        editOrganization: 'ორგანიზაციის რედაქტირება',
        organizationName: 'ორგანიზაციის სახელი:',
        identificationNumber: 'საიდენტიფიკაციო ნომერი',
        employeesCount: 'თანამშრომლების რაოდენობა',
        employeesCountShort: 'თანამშრომელთა რაოდენობა',
        idNumberShort: 'გსნ',
        webService: 'ვებ სერვისი',
        address: 'მისამართი',
        user: 'მომხმარებლი',
        clearPassword: 'წაშლა',
        leaveEmptyPassword: 'თუ არ გსურთ პაროლის შეცვლა, დატოვეთ ცარიელი',

        // Organization form validations
        orgNameRequired: 'შეავსეთ ორგანიზაციის სახელი!',
        idNumberRequired: 'შეავსეთ საიდენტიფიკაციო ნომერი!',
        employeesCountRequired: 'შეავსეთ თანამშრომლების რაოდენობა!',
        webServiceUrlRequired: 'შეავსეთ ვებ სერვისის მისამართი!',
        webServiceUsernameHint: 'შეავსეთ მომხმარელის სახელი!',
        webServicePasswordHint: 'შეავსეთ პაროლი!',

        // Organization notifications
        orgFetchError: 'შეცდომა ორგანიზაციების მიღებისას, შეამოწმეთ ინტერნეტთან კავშირი',
        orgDeleted: 'ორგანიზაცია წაიშლა',
        orgDeletedDesc: (name) => `ორგანიზაცია: ${name}`,
        orgDeleteError: 'შეცდომა ორგანიზაციის წაშლისას:',
        orgCreated: 'ორგანიზაც���ა წარმატებით შეიქმნა!',
        orgCreatedDesc: (name) => `ორგანიზაცია: ${name}`,
        orgCreateError: 'შეცდომა ორგანიზაციის შექმნისას:',
        orgEdited: 'ორგანიზაცია წარმატებიით შეირედაქტირდა',
        orgEditedDesc: (name) => `ორგანიზაცია: ${name}`,
        orgEditError: 'შეცდომა ორგანიზაციის რედაქტირებისას:',

        // ===== Warehouses =====
        addWarehouse: 'საწყობის დამატება',
        editWarehouse: 'საწყობის რედაქტირება',
        warehouseName: 'სახელი:',
        warehouseCode: 'კოდი:',
        nameRequired: 'შეავსეთ სახელი!',
        codeRequired: 'შეავსეთ კოდი!',
        name: 'სახელი',
        code: 'კოდი',

        // Warehouse notifications
        warehouseDeleted: 'საწყობის წაშლა',
        warehouseDeletedDesc: (name) => `საწყობი: "${name}" წაიშალა`,
        warehouseDeleteError: 'საწყობი წაშლა',
        warehouseEdited: 'საწყობის შეცვლა',
        warehouseEditedDesc: (name) => `საწყობი: ${name} შეცვლილია`,
        warehouseEditError: 'საწყობის შეცვლა',
        warehouseAdded: 'საწყობის დამატება',
        warehouseAddedDesc: (name) => `საწყობი: "${name}" დაემატა`,
        warehouseAddError: 'საწყობის დამატება',

        // ===== Users =====
        addUser: 'მომხმარებლის დამატება',
        editUser: 'მომხმარებლის რედაქტირება',
        email: 'ელ. ფოსტა',
        firstName: 'სახელი',
        lastName: 'გვარი',
        role: 'როლი',
        ipAddress: 'IP მისამართი',
        ipEnabled: 'IP ჩართული',
        selectOrganization: 'აირჩიეთ ორგანიზაცია',
        selectWarehouses: 'აირჩიეთ საწყობები',
        selectOrgFirst: 'ჯერ აირჩიეთ ორგანიზაცია',

        // User form validations
        usernameFieldRequired: 'გთხოვთ შეიყვანო�� მომხმარებელი!',
        emailInvalid: 'გთხოვთ შეიყვანოთ სწორი ელ. ფოსტა!',
        passwordFieldRequired: 'გთხოვთ შეიყვანოთ პაროლი!',
        passwordMinLength: 'პაროლი უნდა იყოს მინიმუმ 8 სიმბოლო!',
        roleRequired: 'გთხოვთ აირჩიოთ როლი!',
        ipAddressHint: 'გთხოვთ შეიყვანოთ IP მისამართი!',
        orgRequired: 'გთხოვთ აირჩიოთ ორგანიზაცია!',
        warehouseHint: 'გთხოვთ აირჩიოთ საწყობი!',
        passwordLeaveEmpty: 'თუ არ გსურთ პაროლის შეცვლა, დატოვეთ ცარიელი',

        // User IP descriptions
        yourIp: (ip) => `თქვენი IP მისამართი: ${ip}`,
        orgUsedIp: (ip) => `ორგანიზაციაში გამოყენებული: ${ip}`,

        // User notifications
        userCreated: (username) => `მომხმარებელი "${username}" წარმატებით შეიქმნა`,
        userLimitReached: 'მომხმარებლების ლიმიტი მიღწეულია. გთხოვთ, დაუკავშირდით ადმინისტრატორს დამატებითი ინფორმაციისთვის.',
        cannotDeleteSelf: 'თქვენ არ შეგიძლიათ თქვენი საკუთარი ანგარიშის წაშლა.',
        userDeleted: (username) => `${username} წარმატებით წაიშალა`,
        userUpdated: (username) => `მომხმარებელი "${username}" წარმატებით განახლდა`,
        dataFetchError: 'შეცდომა მონაცემების მიღებისას',

        // ===== Filters =====
        filterName: 'სახელი',
        filterOrganization: 'ორგანიზაცია',
        filterRole: 'როლი',

        // ===== API / Network Errors =====
        networkError: 'ქსელის შეცდომა',
        unknownError: 'უცნობი შეცდომა',

        // ===== Footer =====
        footer: '© 2026 iFlow.ge Powered by IKnow LTD. All rights reserved.',
    },

    en: {
        // ===== Common =====
        search: 'Search',
        clear: 'Clear',
        add: 'Add',
        save: 'Save',
        delete: 'Delete',
        close: 'Close',
        yes: 'Yes',
        no: 'No',
        error: 'Error',
        success: 'Success',
        result: 'Result',
        loading: 'Loading...',
        confirmDelete: 'Are you sure you want to delete?',
        logout: 'Logout',
        language: 'Language',
        georgian: 'ქართული',
        english: 'English',

        // ===== Login =====
        username: 'Username',
        password: 'Password',
        login: 'Login',
        usernameRequired: 'Please enter your username!',
        passwordRequired: 'Please enter your password!',
        invalidCredentials: 'Invalid username or password',

        // ===== Login Errors =====
        ipNotAllowed: 'Your IP address is not allowed. Please contact the administrator.',

        // ===== Dashboard / Product Search =====
        productSearch: 'Product Search',
        productSearchSubtitle: 'Search for a product by barcode or article number',
        searchingProduct: 'Searching for product...',
        barcode: 'Barcode',
        article: 'Article',
        product: 'Product',
        allWarehouses: 'All Warehouses',
        scan: 'Scan',
        searchPlaceholder: 'Search',
        selectSearchType: 'Please select a search type!',
        enterSearchText: 'Please enter search text!',
        warehouse: 'Warehouse',
        balance: 'Balance',
        price: 'Price',

        // ===== Product Search Errors =====
        productNotFound: 'Product not found in web service',
        externalServiceTimeout: 'Connection to web service timed out. Please try again later.',
        externalServiceUnavailable: 'Unable to connect to web service. Please try again later.',
        externalServiceError: 'Communication error with web service. Please try again later.',
        externalServiceUnauthorized: 'Authorization to web service failed. Please contact the administrator.',
        webServiceError: 'Web Service Error',
        productSearchError: 'An error occurred while searching for the product',
        productNotFoundOrNoBalance: 'Product not found or no balance available',

        // ===== System Admin Dashboard =====
        organizations: 'Organizations',
        warehouses: 'Warehouses',
        users: 'Users',

        // ===== Organizations =====
        organization: 'Organization',
        addOrganization: 'Add Organization',
        editOrganization: 'Edit Organization',
        organizationName: 'Organization Name:',
        identificationNumber: 'Identification Number',
        employeesCount: 'Number of Employees',
        employeesCountShort: 'Employees Count',
        idNumberShort: 'ID Number',
        webService: 'Web Service',
        address: 'Address',
        user: 'User',
        clearPassword: 'Clear',
        leaveEmptyPassword: "Leave empty if you don't want to change the password",

        // Organization form validations
        orgNameRequired: 'Please enter the organization name!',
        idNumberRequired: 'Please enter the identification number!',
        employeesCountRequired: 'Please enter the number of employees!',
        webServiceUrlRequired: 'Please enter the web service URL!',
        webServiceUsernameHint: 'Please enter the username!',
        webServicePasswordHint: 'Please enter the password!',

        // Organization notifications
        orgFetchError: 'Error fetching organizations, check your internet connection',
        orgDeleted: 'Organization Deleted',
        orgDeletedDesc: (name) => `Organization: ${name}`,
        orgDeleteError: 'Error deleting organization:',
        orgCreated: 'Organization created successfully!',
        orgCreatedDesc: (name) => `Organization: ${name}`,
        orgCreateError: 'Error creating organization:',
        orgEdited: 'Organization edited successfully',
        orgEditedDesc: (name) => `Organization: ${name}`,
        orgEditError: 'Error editing organization:',

        // ===== Warehouses =====
        addWarehouse: 'Add Warehouse',
        editWarehouse: 'Edit Warehouse',
        warehouseName: 'Name:',
        warehouseCode: 'Code:',
        nameRequired: 'Please enter the name!',
        codeRequired: 'Please enter the code!',
        name: 'Name',
        code: 'Code',

        // Warehouse notifications
        warehouseDeleted: 'Warehouse Deleted',
        warehouseDeletedDesc: (name) => `Warehouse: "${name}" has been deleted`,
        warehouseDeleteError: 'Warehouse Deletion',
        warehouseEdited: 'Warehouse Updated',
        warehouseEditedDesc: (name) => `Warehouse: ${name} has been updated`,
        warehouseEditError: 'Warehouse Update',
        warehouseAdded: 'Warehouse Added',
        warehouseAddedDesc: (name) => `Warehouse: "${name}" has been added`,
        warehouseAddError: 'Warehouse Addition',

        // ===== Users =====
        addUser: 'Add User',
        editUser: 'Edit User',
        email: 'Email',
        firstName: 'First Name',
        lastName: 'Last Name',
        role: 'Role',
        ipAddress: 'IP Address',
        ipEnabled: 'IP Enabled',
        selectOrganization: 'Select Organization',
        selectWarehouses: 'Select Warehouses',
        selectOrgFirst: 'Select an organization first',

        // User form validations
        usernameFieldRequired: 'Please enter a username!',
        emailInvalid: 'Please enter a valid email!',
        passwordFieldRequired: 'Please enter a password!',
        passwordMinLength: 'Password must be at least 8 characters!',
        roleRequired: 'Please select a role!',
        ipAddressHint: 'Please enter an IP address!',
        orgRequired: 'Please select an organization!',
        warehouseHint: 'Please select a warehouse!',
        passwordLeaveEmpty: "Leave empty if you don't want to change the password",

        // User IP descriptions
        yourIp: (ip) => `Your IP address: ${ip}`,
        orgUsedIp: (ip) => `Used in organization: ${ip}`,

        // User notifications
        userCreated: (username) => `User "${username}" created successfully`,
        userLimitReached: 'User limit reached. Please contact the administrator for more information.',
        cannotDeleteSelf: 'You cannot delete your own account.',
        userDeleted: (username) => `${username} deleted successfully`,
        userUpdated: (username) => `User "${username}" updated successfully`,
        dataFetchError: 'Error fetching data',

        // ===== Filters =====
        filterName: 'Name',
        filterOrganization: 'Organization',
        filterRole: 'Role',

        // ===== API / Network Errors =====
        networkError: 'Network error',
        unknownError: 'Unknown error',

        // ===== Footer =====
        footer: '© 2026 iFlow.ge Powered by IKnow LTD. All rights reserved.',
    },
};

export default translations;
