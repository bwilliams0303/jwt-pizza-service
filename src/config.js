module.exports =  {
    // Your JWT secret can be any random string you would like. It just needs to be secret.
    jwtSecret: process.env.JWT_SECRET,
    db: {
        connection: {
            host: '127.0.0.1',
            user: 'root',
            password: process.env.DB_PASSWORD,
            database: 'pizza',
            connectTimeout: 60000,
        },
        listPerPage: 10,
    },
    factory: {
        url: 'https://pizza-factory.cs329.click',
        apiKey: process.env.FACTORY_API_KEY,
    },
};
