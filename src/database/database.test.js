const { DB } = require('./database.js');
const logger = require('../logger.js');

test('every query is logged', async () => {
  const dbLogger = jest.spyOn(logger, 'dbLogger');

  await DB.getMenu();

  expect(dbLogger).toHaveBeenCalledWith('SELECT * FROM menu');
});
