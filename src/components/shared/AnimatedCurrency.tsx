import React, { useEffect, useRef } from 'react';
import { motion, useSpring, useTransform } from 'framer-motion';
import { formatCurrency } from '../../utils/gameUtils';

interface AnimatedCurrencyProps {
    value: number;
    currencySymbol: string;
    className?: string;
}

export function AnimatedCurrency({ value, currencySymbol, className }: AnimatedCurrencyProps) {
    const spring = useSpring(value, {
        mass: 0.5,
        stiffness: 120,
        damping: 30,
        restDelta: 0.1
    });

    const displayValue = useTransform(spring, (latest) =>
        formatCurrency(Math.floor(latest), currencySymbol)
    );

    const prevValueRef = useRef(value);

    useEffect(() => {
        spring.set(value);
        prevValueRef.current = value;
    }, [value, spring]);

    return (
        <motion.span className={className}>
            {displayValue}
        </motion.span>
    );
}
