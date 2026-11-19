/**
 * Commonly used passwords that meet the length rule (Issue #1280, ASVS V6.2.4).
 *
 * Only entries of at least MIN_PASSWORD_LENGTH characters are listed: anything shorter is
 * already refused by the length rule. Compared lower-case. The list is drawn from the most
 * frequent entries of public password-frequency lists; it is a floor, not a complete list.
 * A deployment adds its own with `PASSWORD_DENYLIST_FILE` (one password per line) and catches
 * breached passwords with `PASSWORD_BREACH_CHECK=hibp` (lib/auth/password-policy.ts).
 */
export const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  '12345678', '123456789', '1234567890', '12345678910', '0123456789', '987654321', '9876543210',
  '11111111', '111111111', '1111111111', '00000000', '000000000', '0000000000', '88888888', '66666666',
  '99999999', '22222222', '55555555', '12341234', '12121212', '11223344', '12344321', '87654321',
  '1q2w3e4r', '1q2w3e4r5t', '1q2w3e4r5t6y', 'q1w2e3r4', 'q1w2e3r4t5', '1qaz2wsx', '1qaz2wsx3edc',
  'zaq12wsx', 'zaq1zaq1', 'qazwsxedc', 'qwertyuiop', 'qwerty123', 'qwerty1234', 'qwerty12345',
  'qwertyui', 'asdfghjkl', 'asdfghjk', 'asdf1234', 'zxcvbnm1', 'zxcvbnm123', 'qweasdzxc', '1234qwer',
  'abcd1234', 'abc12345', 'abc123456', 'abcdefgh', 'abcdefg1', 'a1b2c3d4', 'aa123456', 'aa12345678',
  'password', 'password1', 'password12', 'password123', 'password1234', 'password!', 'password@123',
  'passw0rd', 'p@ssw0rd', 'p@ssword', 'pa$$word', 'pass1234', 'passpass', 'mypassword', 'newpassword',
  'iloveyou', 'iloveyou1', 'iloveyou2', 'loveyou1', 'sunshine', 'sunshine1', 'princess', 'princess1',
  'football', 'football1', 'baseball', 'baseball1', 'basketball', 'superman', 'batman123', 'spiderman',
  'starwars', 'pokemon1', 'charlie1', 'michael1', 'jennifer', 'jordan23', 'liverpool', 'chelsea1',
  'arsenal1', 'trustno1', 'whatever', 'welcome1', 'welcome123', 'letmein1', 'letmein123', 'computer',
  'internet', 'master123', 'monkey123', 'dragon123', 'shadow123', 'access14', 'administrator',
  'admin123', 'admin1234', 'admin12345', 'adminadmin', 'administrator1', 'root1234', 'rootroot',
  'changeme', 'changeme1', 'changeme123', 'default1', 'guest123', 'test1234', 'test12345', 'testtest',
  'testing123', 'temp1234', 'secret123', 'qwerty1!', 'zaq!2wsx', '!qaz2wsx', '1qaz!qaz', 'q1w2e3r4t5y6',
  'football123', 'samsung1', 'samsung123', 'google123', 'facebook', 'linkedin', 'microsoft', 'apple123',
  'asdfasdf', 'qwerqwer', 'zxczxczx', 'aaaaaaaa', 'aaaaaaaaa', 'abcabcabc', 'abc123abc', '123abc123',
  'iloveu123', 'lovelove', 'loveme123', 'baby1234', 'hello123', 'hello1234', 'helloworld', 'goodluck',
  'freedom1', 'summer123', 'winter123', 'spring123', 'autumn123', 'monday123', 'january1', 'december',
  'nopassword', 'unknown1', 'student1', 'teacher1', 'company1', 'company123', 'business', 'mustang1',
  'killer123', 'ninja123', 'matrix123', 'diamond1', 'blessed1', 'jesus123', 'angel123', 'flower123',
  'chocolate', 'butterfly', 'babygirl1', 'danielle', 'jessica1', 'nicole123', 'ashley123', 'hannah123',
  'qwe123qwe', 'asd123asd', 'zxc123zxc', '147258369', '159753456', '741852963', '123qweasd', 'qweasd123',
  'a12345678', 'q12345678', 'z12345678', '1234abcd', '12qwaszx', '123123123', '123321123', '12345qwert',
  'qwert12345', 'asdf12345', 'pa55word', 'pa55w0rd', 'passw0rd1', 'p4ssw0rd', 'p455w0rd',
]);
