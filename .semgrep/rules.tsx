// ruleid: react-dangerously-set-inner-html
const a = (html: string) => <div dangerouslySetInnerHTML={{ __html: html }} />;
// ok: react-dangerously-set-inner-html
const b = (text: string) => <div>{text}</div>;
