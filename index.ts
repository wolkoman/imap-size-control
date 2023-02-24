import * as imaps from 'imap-simple';
import {ImapSimple} from 'imap-simple';
import * as mailparser from 'mailparser';
import {EmailAddress} from 'mailparser';
import {config} from "./config";
import Imap = require("imap");

const fs = require("fs")


imaps.connect(config).then(async connection => {
    const mailboxes = listBoxes(await connection.getBoxes());
    await mailboxes.reduce<Promise<void>>(async (promise, box) => {
        await promise;
        console.log("HANDLING " + box);
        await handleMailbox(connection, box);
    }, Promise.resolve());
});

function listBoxes(boxes: Imap.MailBoxes, prepend = ""): string[] {
    if(boxes === null) return [];
    return Object.entries(boxes)
        .flatMap(([name, {delimiter, children}]) => [name, ...listBoxes(children, name + delimiter)])
        .map(name => prepend + name);
}


async function handleMailbox(connection: ImapSimple, mailbox: string) {

    // open mailbox and find big mails
    await connection.openBox(mailbox);
    console.log("opened " +mailbox);
    const searchCriteria = [["LARGER", 10_000_000], ["BEFORE", new Date(2022, 1, 1)]];
    const fetchOptions = {bodies: [''], markSeen: false};
    const results = await connection.search(searchCriteria, fetchOptions);
    console.log(`${mailbox}: Found ${results.length} results!`);

    // parse mails
    const mails = await Promise.all(results.map(item => new Promise<{ mail: mailparser.ParsedMail, uid: number }>((res) => {
        const all = item.parts.find(item => item.which === "")!;
        const uid = item.attributes.uid;
        const idHeader = "Imap-Id: " + uid + "\r\n";
        mailparser.simpleParser(idHeader + all.body, (err, mail) => res({mail, uid}));
    })));
    console.log(mails.map(({mail}) => `${mail.date} ${mail.subject}`).join("\n"))

    // save files and install replacement
    if(results.length !== 0) console.log("Restoring and saving");
    await mails.reduce<Promise<void>>(async (promise,{mail, uid}) => {
        await promise;
        const files = await saveFilesInMail(mail, mailbox, uid);
        await connection.append(
            generateReplacementMail(mail, files, uid),
            {mailbox, date: mail.date}
        );
    }, Promise.resolve());

    // delete originals mails
    if(results.length !== 0) console.log("Deleting");
    await deleteMails(mails.map(mail => mail.uid), connection);

    return connection.closeBox(true);
}


function generateReplacementMail(mail: mailparser.ParsedMail, files: string[], uid: number): any {
    const to = (Array.isArray(mail.to) ? mail.to : [mail.to]).flatMap(to => to?.value).filter((to): to is EmailAddress => !!to);
    const content = mail.html ? mail.html : mail.text;
    const c = (content?.length ?? 0) > 1_000_000 ? `Der Inhalt ist zu groß (UID ${uid}, date ${mail.date}, messageid ${mail.messageId}).` : content;
    return `Content-Type: text/html
To:${to.map(({address}) => address).join(";")}
Subject: ${mail.subject}

${c}\n<br/>Folgende Dateien im Anhang wurden ausgelagert: ${files.join(",\n<br/>")}
`;
}

function deleteMails(mails: number[], connection: imaps.ImapSimple) {
    return Promise.all(mails.map((id) => connection.deleteMessage([id])));
}

function saveFilesInMail(mail: mailparser.ParsedMail, mailbox: string, uid: number) {
    const path = `${config.imap.user}/${mailbox}`;
    fs.mkdirSync(path, {recursive: true});
        fs.writeFileSync(
            `${path}/${uid}.txt`,
            mail.text
        );
    return Promise.all(mail.attachments.map(async (attachment,index) => {
        console.log(`Save ${mail.date} ${mail.subject} ${attachment.filename}`);
        const newFileName = `${new Date(mail.date ?? "").toISOString().substring(0,10)}_${uid}_${index}_${attachment.filename}`;
        fs.writeFileSync(`${path}/${newFileName}`, attachment.content);
        return newFileName;
    }));
}
