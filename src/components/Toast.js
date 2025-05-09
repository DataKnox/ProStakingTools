import React, { useEffect } from 'react';

const Toast = ({ message, type = 'error', onClose }) => {
    useEffect(() => {
        const timer = setTimeout(() => {
            onClose();
        }, 5000); // Auto close after 5 seconds

        return () => clearTimeout(timer);
    }, [onClose]);

    return (
        <div className={`toast ${type}`}>
            {message}
            <button className="toast-close" onClick={onClose}>×</button>
        </div>
    );
};

export default Toast; 