/** Helpers to send a review link to a client: copy, WhatsApp and email. */

/** wa.me needs the number in international format without "+" (South African 0XX… → 27XX…). */
export function whatsappNumber(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('0') && digits.length === 10) return `27${digits.slice(1)}`;
    return digits;
}

export function reviewMessage({ clientName, contactName, title, url, count }) {
    const hi = contactName ? `Hi ${contactName.split(' ')[0]}` : clientName ? `Hi ${clientName} team` : 'Hi';
    const what = count > 1 ? `${count} videos` : 'a video';
    return `${hi}, ${what} for "${title}" ${count > 1 ? 'are' : 'is'} ready for your review. You can watch, comment and approve here (no login needed):\n${url}`;
}

export function whatsappLink(phone, text) {
    const number = whatsappNumber(phone);
    return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

export function mailtoLink(email, subject, body) {
    return `mailto:${encodeURIComponent(email || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
